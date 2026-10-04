package com.railway.common.messaging;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.railway.common.events.Envelope;

import java.io.IOException;
import java.io.UncheckedIOException;

/** One shared, explicitly configured ObjectMapper for the wire format. */
public final class Json {
    public static final ObjectMapper MAPPER = new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);

    private Json() {
    }

    public static String write(Object value) {
        try {
            return MAPPER.writeValueAsString(value);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    public static Envelope readEnvelope(String json) {
        try {
            return MAPPER.readValue(json, Envelope.class);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    public static <T> T payload(Envelope envelope, Class<T> type) {
        return convert(envelope.payload(), type);
    }

    public static <T> T convert(JsonNode node, Class<T> type) {
        try {
            return MAPPER.treeToValue(node, type);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
