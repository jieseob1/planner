package io.nowline.planner.account;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

import static io.nowline.planner.persistence.JdbcValues.id;

@Repository
public class AccountDeletionRepository {

    private final JdbcTemplate jdbc;

    public AccountDeletionRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional
    public void deleteLocal(UUID userId) {
        jdbc.update("""
                INSERT INTO deleted_identity_tombstone (user_id, deleted_at)
                VALUES (?, CURRENT_TIMESTAMP(6)) AS deletion
                ON DUPLICATE KEY UPDATE deleted_at = deletion.deleted_at
                """, id(userId));
        jdbc.update("DELETE FROM app_user WHERE user_id = ?", id(userId));
    }
}
