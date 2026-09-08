package io.nowline.planner.notification;

import io.nowline.planner.account.UserPreferenceService.Preferences;
import io.nowline.planner.domain.PlannerSnapshot;

import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.stream.Collectors;

/** Pure schedule policy shared by generation and the last pre-dispatch check. */
final class ReminderSchedule {
    private ReminderSchedule() {}

    static Map<String, PlannerSnapshot.Task> tasks(PlannerSnapshot snapshot) {
        return snapshot.tasks().stream().collect(Collectors.toMap(PlannerSnapshot.Task::id, task -> task));
    }

    static BlockReminder block(PlannerSnapshot.TimeBlock block, Map<String, PlannerSnapshot.Task> tasks, Preferences preferences) {
        // Imported events retain Google Calendar's own alarm policy. Copying them would double-notify.
        if (block.externalOrFalse() || block.date() == null) return null;
        if (block.taskId() != null) {
            var task = tasks.get(block.taskId());
            if (task == null || task.status() == PlannerSnapshot.TaskStatus.DONE
                    || task.status() == PlannerSnapshot.TaskStatus.CANCELLED) return null;
        }
        ZoneId zone = ZoneId.of(preferences.timezone());
        // startMinutes is a wall-clock minute, not elapsed minutes since a DST-dependent midnight.
        Instant start = block.date().atTime(LocalTime.MIDNIGHT.plusMinutes(block.startMinutes()))
                .atZone(zone).toInstant();
        Instant target = start.minus(preferences.blockReminderMinutes(), ChronoUnit.MINUTES);
        String key = "block:v2:" + block.id() + ":" + start.toEpochMilli() + ":" + preferences.blockReminderMinutes();
        return new BlockReminder(key, start, target, block.title(), preferences.blockReminderMinutes(), "/today?date=" + block.date());
    }

    static boolean withinDispatchWindow(Instant now, Instant target) {
        return !now.isBefore(target) && !now.isAfter(target.plusSeconds(120));
    }

    record BlockReminder(String key, Instant start, Instant target, String title, int leadMinutes, String targetPath) {
        String body() {
            return leadMinutes == 0 ? "지금 시작할 시간입니다." : leadMinutes + "분 뒤 시작합니다.";
        }

        boolean notStarted(Instant now) {
            return leadMinutes == 0 || now.isBefore(start);
        }
    }
}
