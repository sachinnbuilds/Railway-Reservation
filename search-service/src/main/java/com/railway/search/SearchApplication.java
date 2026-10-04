package com.railway.search;

import org.springframework.boot.SpringApplication;
import com.railway.common.messaging.KafkaSetup;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Import;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication(scanBasePackages = {"com.railway.search", "com.railway.common.web"})
@EnableScheduling
@Import(KafkaSetup.class)
public class SearchApplication {
    public static void main(String[] args) {
        SpringApplication.run(SearchApplication.class, args);
    }
}
