package io.nowline.planner.api;

import io.nowline.planner.service.PlannerException;
import io.nowline.planner.service.PlannerPrecondition;
import org.junit.jupiter.api.Test;

import java.util.UUID;

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

    @Test
    void acceptsOnlyTheAuthenticatedSubjectsEtag() {
        UUID owner = UUID.fromString("11111111-1111-4111-8111-111111111111");
        UUID otherUser = UUID.fromString("22222222-2222-4222-8222-222222222222");
        String ownerEtag = HttpPreconditions.etag(owner, 42);

        assertThat(ownerEtag).startsWith("\"planner-").endsWith("-42\"");
        assertThat(HttpPreconditions.forPut(owner, ownerEtag, null).expectedRevision()).isEqualTo(42L);
        assertThat(HttpPreconditions.forDelete(owner, ownerEtag).expectedRevision()).isEqualTo(42L);
        assertThat(HttpPreconditions.matchesForGet(ownerEtag, owner, 42)).isTrue();
        assertThat(HttpPreconditions.matchesForGet("W/" + ownerEtag, owner, 42)).isTrue();

        assertThat(HttpPreconditions.etag(otherUser, 42)).isNotEqualTo(ownerEtag);
        assertThat(HttpPreconditions.matchesForGet(ownerEtag, otherUser, 42)).isFalse();
        assertThatThrownBy(() -> HttpPreconditions.forPut(otherUser, ownerEtag, null))
                .isInstanceOf(PlannerException.class);
        assertThatThrownBy(() -> HttpPreconditions.forDelete(otherUser, ownerEtag))
                .isInstanceOf(PlannerException.class);
    }
}
