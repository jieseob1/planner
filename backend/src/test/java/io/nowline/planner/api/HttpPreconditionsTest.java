package io.nowline.planner.api;

import io.nowline.planner.service.PlannerException;
import io.nowline.planner.service.PlannerPrecondition;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class HttpPreconditionsTest {

    @Test
    void parsesCreateAndStrongUpdateConditions() {
        assertThat(HttpPreconditions.forPut(null, "*").mode())
                .isEqualTo(PlannerPrecondition.Mode.CREATE);
        assertThat(HttpPreconditions.forPut("\"42\"", null).expectedRevision())
                .isEqualTo(42L);
    }

    @Test
    void rejectsMissingWeakOrAmbiguousWriteConditions() {
        assertThatThrownBy(() -> HttpPreconditions.forPut(null, null))
                .isInstanceOf(PlannerException.class);
        assertThatThrownBy(() -> HttpPreconditions.forPut("W/\"1\"", null))
                .isInstanceOf(PlannerException.class);
        assertThatThrownBy(() -> HttpPreconditions.forPut("\"1\"", "*"))
                .isInstanceOf(PlannerException.class);
    }

    @Test
    void supportsWeakConditionalGetComparison() {
        assertThat(HttpPreconditions.matchesForGet("\"3\", W/\"4\"", 4)).isTrue();
        assertThat(HttpPreconditions.matchesForGet("\"3\"", 4)).isFalse();
    }
}
