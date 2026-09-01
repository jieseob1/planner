package io.nowline.planner.config;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "nowline.migration-only", havingValue = "true")
public class MigrationOnlyExit {

    private final ConfigurableApplicationContext context;

    public MigrationOnlyExit(ConfigurableApplicationContext context) {
        this.context = context;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void closeAfterFlywayMigration() {
        SpringApplication.exit(context, () -> 0);
    }
}
