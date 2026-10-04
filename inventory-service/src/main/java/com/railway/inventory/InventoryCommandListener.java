package com.railway.inventory;

import com.railway.common.events.Envelope;
import com.railway.common.events.EventTypes;
import com.railway.common.events.Messages.ConfirmSeats;
import com.railway.common.events.Messages.HoldSeats;
import com.railway.common.events.Messages.ReleaseSeats;
import com.railway.common.events.Messages.SeatsConfirmFailed;
import com.railway.common.events.Messages.SeatsConfirmed;
import com.railway.common.events.Messages.SeatsHeld;
import com.railway.common.events.Messages.SeatsRejected;
import com.railway.common.events.Messages.SeatsReleased;
import com.railway.common.events.Topics;
import com.railway.common.messaging.Idempotency;
import com.railway.common.messaging.Json;
import com.railway.common.messaging.Outbox;
import io.micrometer.core.instrument.MeterRegistry;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Consumes {@code inventory.commands}. The topic is keyed by runId, so all commands for one train
 * run arrive in order on one partition and are handled by one thread: Tatkal requests for a hot
 * train are serialized cheaply in Kafka instead of fighting over row locks in Postgres, while
 * different trains are processed in parallel on other partitions / instances.
 */
@Component
public class InventoryCommandListener {

    private static final Logger log = LoggerFactory.getLogger(InventoryCommandListener.class);

    private final SeatInventory inventory;
    private final Idempotency idempotency;
    private final Outbox outbox;
    private final TransactionTemplate tx;
    private final MeterRegistry meters;
    private final AllocationMode mode;
    /** NAIVE mode only: process holds in parallel, the way a thread-per-request service would. */
    private final ExecutorService naiveWorkers = Executors.newFixedThreadPool(32);

    public InventoryCommandListener(SeatInventory inventory, Idempotency idempotency, Outbox outbox,
                                    TransactionTemplate tx, MeterRegistry meters, AllocationMode mode) {
        this.inventory = inventory;
        this.idempotency = idempotency;
        this.outbox = outbox;
        this.tx = tx;
        this.meters = meters;
        this.mode = mode;
    }

    @KafkaListener(topics = Topics.INVENTORY_COMMANDS)
    public void onCommand(ConsumerRecord<String, String> record) {
        Envelope env = Json.readEnvelope(record.value());
        if (EventTypes.HOLD_SEATS.equals(env.type()) && mode.get() == AllocationMode.Mode.NAIVE) {
            // Demo of the broken design: no per-train ordering (parallel workers) and no locking.
            naiveWorkers.submit(() -> {
                try {
                    process(env, record.partition());
                } catch (Exception e) {
                    log.warn("NAIVE hold failed: {}", e.toString());
                }
            });
            return;
        }
        process(env, record.partition());
    }

    private void process(Envelope env, int partition) {
        tx.executeWithoutResult(status -> {
            if (!idempotency.firstDelivery(env.messageId())) {
                log.info("Duplicate {} {} ignored", env.type(), env.messageId());
                meters.counter("inventory_duplicate_messages").increment();
                return;
            }
            switch (env.type()) {
                case EventTypes.HOLD_SEATS -> hold(Json.payload(env, HoldSeats.class), partition);
                case EventTypes.CONFIRM_SEATS -> confirm(Json.payload(env, ConfirmSeats.class));
                case EventTypes.RELEASE_SEATS -> release(Json.payload(env, ReleaseSeats.class));
                default -> log.warn("Unknown command type {}", env.type());
            }
        });
    }

    private void hold(HoldSeats cmd, int partition) {
        UUID bookingId = UUID.fromString(cmd.bookingId());
        boolean naive = mode.get() == AllocationMode.Mode.NAIVE;
        SeatInventory.HoldResult result = naive
                ? inventory.holdNaive(bookingId, cmd.runId(), cmd.travelClass(), cmd.seatCount(), cmd.holdSeconds())
                : inventory.hold(bookingId, cmd.runId(), cmd.travelClass(), cmd.seatCount(), cmd.holdSeconds());
        log.info("HoldSeats booking={} run={} class={} partition={} mode={} -> {}", cmd.bookingId(), cmd.runId(),
                cmd.travelClass(), partition, naive ? "NAIVE" : "SAFE", result);
        switch (result) {
            case SeatInventory.Held held -> {
                meters.counter("seat_holds", "outcome", "held").increment();
                outbox.enqueue(Topics.INVENTORY_EVENTS, cmd.bookingId(), EventTypes.SEATS_HELD,
                        new SeatsHeld(cmd.bookingId(), cmd.runId(), cmd.travelClass(), held.seats(), held.expiresAt()));
            }
            case SeatInventory.Rejected rejected -> {
                meters.counter("seat_holds", "outcome", "rejected").increment();
                outbox.enqueue(Topics.INVENTORY_EVENTS, cmd.bookingId(), EventTypes.SEATS_REJECTED,
                        new SeatsRejected(cmd.bookingId(), cmd.runId(), rejected.reason()));
            }
        }
    }

    private void confirm(ConfirmSeats cmd) {
        UUID bookingId = UUID.fromString(cmd.bookingId());
        List<String> seats = inventory.isNaiveBooking(bookingId)
                ? inventory.confirmNaive(bookingId) : inventory.confirm(bookingId);
        log.info("ConfirmSeats booking={} run={} -> {}", cmd.bookingId(), cmd.runId(),
                seats.isEmpty() ? "FAILED (hold expired)" : "BOOKED " + seats);
        if (seats.isEmpty()) {
            outbox.enqueue(Topics.INVENTORY_EVENTS, cmd.bookingId(), EventTypes.SEATS_CONFIRM_FAILED,
                    new SeatsConfirmFailed(cmd.bookingId(), cmd.runId(), "HOLD_EXPIRED"));
        } else {
            outbox.enqueue(Topics.INVENTORY_EVENTS, cmd.bookingId(), EventTypes.SEATS_CONFIRMED,
                    new SeatsConfirmed(cmd.bookingId(), cmd.runId(), seats));
        }
    }

    private void release(ReleaseSeats cmd) {
        UUID bookingId = UUID.fromString(cmd.bookingId());
        int n = inventory.isNaiveBooking(bookingId) ? inventory.releaseNaive(bookingId) : inventory.release(bookingId);
        log.info("ReleaseSeats booking={} run={} reason={} -> released {} seats", cmd.bookingId(), cmd.runId(),
                cmd.reason(), n);
        outbox.enqueue(Topics.INVENTORY_EVENTS, cmd.bookingId(), EventTypes.SEATS_RELEASED,
                new SeatsReleased(cmd.bookingId(), cmd.runId(), cmd.reason()));
    }
}
