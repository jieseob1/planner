package io.nowline.planner.account;

import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import java.util.Locale;

/** Allow-listed presentation language, independent from schedule time zones and user text. */
public final class DisplayLanguage {
    private DisplayLanguage() {}
    public static String of(String locale) {
        if (locale == null || locale.isBlank()) return "ko";
        String primary = locale.toLowerCase(Locale.ROOT).split("[-_]", 2)[0];
        return switch (primary) { case "ko", "es" -> primary; default -> "en"; };
    }
    public static String requestLanguage() {
        if (!(RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes)) return "ko";
        String header = attributes.getRequest().getHeader("Accept-Language");
        if (header == null || header.isBlank()) return "ko";
        try {
            for (var range : Locale.LanguageRange.parse(header)) {
                String primary = range.getRange().split("-", 2)[0];
                if (range.getWeight() > 0 && java.util.Set.of("ko", "en", "es").contains(primary)) return primary;
            }
        } catch (IllegalArgumentException ignored) { /* Does not affect authentication. */ }
        return "en";
    }
    public static String choose(String locale, String korean, String english, String spanish) {
        return switch (of(locale)) { case "ko" -> korean; case "es" -> spanish; default -> english; };
    }
    public static String reportName(String locale) { return choose(locale, "Korean", "English", "Spanish"); }
    public static String dailyTitle(String locale) { return choose(locale, "오늘의 Goals to Today를 확인하세요", "Check your Goals to Today plan", "Consulta tu plan de Goals to Today"); }
    public static String dailyBody(String locale, long count) {
        return choose(locale, "실행할 작업 " + count + "개와 오늘 시간 블록을 확인할 시간입니다.",
                "Time to review " + count + (count == 1 ? " task" : " tasks") + " and today’s time blocks.",
                "Es hora de revisar " + count + (count == 1 ? " tarea" : " tareas") + " y los bloques de hoy.");
    }
    public static String blockBody(String locale, int minutes) {
        if (minutes == 0) return choose(locale, "지금 시작할 시간입니다.", "It’s time to start.", "Es hora de empezar.");
        return choose(locale, minutes + "분 뒤 시작합니다.", "Starts in " + minutes + (minutes == 1 ? " minute." : " minutes."),
                "Empieza en " + minutes + (minutes == 1 ? " minuto." : " minutos."));
    }
}
