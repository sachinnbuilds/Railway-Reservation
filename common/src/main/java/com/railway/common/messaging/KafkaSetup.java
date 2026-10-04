package com.railway.common.messaging;

import com.railway.common.events.Topics;
import org.apache.kafka.clients.admin.NewTopic;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.TopicBuilder;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.listener.DeadLetterPublishingRecoverer;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.util.backoff.ExponentialBackOff;

/**
 * Topics are declared by every service that uses Kafka (creation is idempotent). A message whose
 * handler keeps failing is retried with backoff and then parked on {@code <topic>.DLT} so one
 * poison message cannot block its partition forever.
 */
@Configuration
public class KafkaSetup {

    private static final Logger log = LoggerFactory.getLogger(KafkaSetup.class);

    @Bean
    NewTopic inventoryCommandsTopic(@Value("${kafka.partitions:6}") int partitions) {
        return TopicBuilder.name(Topics.INVENTORY_COMMANDS).partitions(partitions).replicas(1).build();
    }

    @Bean
    NewTopic inventoryEventsTopic(@Value("${kafka.partitions:6}") int partitions) {
        return TopicBuilder.name(Topics.INVENTORY_EVENTS).partitions(partitions).replicas(1).build();
    }

    @Bean
    NewTopic availabilityEventsTopic(@Value("${kafka.partitions:6}") int partitions) {
        return TopicBuilder.name(Topics.AVAILABILITY_EVENTS).partitions(partitions).replicas(1).build();
    }

    @Bean
    NewTopic bookingEventsTopic(@Value("${kafka.partitions:6}") int partitions) {
        return TopicBuilder.name(Topics.BOOKING_EVENTS).partitions(partitions).replicas(1).build();
    }

    @Bean
    DefaultErrorHandler kafkaErrorHandler(KafkaTemplate<String, String> template) {
        ExponentialBackOff backOff = new ExponentialBackOff(200, 2.0);
        backOff.setMaxElapsedTime(10_000);
        DeadLetterPublishingRecoverer recoverer = new DeadLetterPublishingRecoverer(template) {
            @Override
            public void accept(org.apache.kafka.clients.consumer.ConsumerRecord<?, ?> record,
                               org.apache.kafka.clients.consumer.Consumer<?, ?> consumer, Exception e) {
                log.error("Giving up on {}-{}@{}; sending to DLT: {}", record.topic(), record.partition(),
                        record.offset(), e.toString());
                super.accept(record, consumer, e);
            }
        };
        return new DefaultErrorHandler(recoverer, backOff);
    }
}
