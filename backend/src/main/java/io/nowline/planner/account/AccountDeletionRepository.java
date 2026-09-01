package io.nowline.planner.account;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Repository
public class AccountDeletionRepository {

    private final JdbcTemplate jdbc;

    public AccountDeletionRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional
    public void deleteLocal(UUID userId) {
        jdbc.update("DELETE FROM app_user WHERE user_id = ?", userId);
    }
}
