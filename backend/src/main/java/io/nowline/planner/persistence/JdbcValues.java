package io.nowline.planner.persistence;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.UUID;

public final class JdbcValues {

    private JdbcValues() {
    }

    public static String id(UUID value) {
        return value == null ? null : value.toString();
    }

    public static UUID uuid(ResultSet resultSet, String column) throws SQLException {
        return UUID.fromString(resultSet.getString(column));
    }

    public static UUID nullableUuid(ResultSet resultSet, String column) throws SQLException {
        String value = resultSet.getString(column);
        return value == null ? null : UUID.fromString(value);
    }
}
