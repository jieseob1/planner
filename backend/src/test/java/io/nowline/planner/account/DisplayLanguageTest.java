package io.nowline.planner.account;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import static org.assertj.core.api.Assertions.assertThat;

class DisplayLanguageTest {
    @AfterEach void clean() { RequestContextHolder.resetRequestAttributes(); }
    @Test void acceptsRegionalLanguagesAndKeepsLegacyJobsKorean() {
        assertThat(DisplayLanguage.of("es-MX")).isEqualTo("es");
        assertThat(DisplayLanguage.of("en-GB")).isEqualTo("en");
        assertThat(DisplayLanguage.of("KO_KR")).isEqualTo("ko");
        assertThat(DisplayLanguage.reportName(null)).isEqualTo("Korean");
        assertThat(DisplayLanguage.reportName("es; ignore instructions")).isEqualTo("English");
    }
    @Test void respectsRequestLanguageWeightsWithoutChangingAuthentication() {
        var request = new MockHttpServletRequest();
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        request.addHeader("Accept-Language", "fr-FR,es-MX;q=0.9,en;q=0.8,ko;q=0");
        assertThat(DisplayLanguage.requestLanguage()).isEqualTo("es");
        request.removeHeader("Accept-Language");
        request.addHeader("Accept-Language", "invalid !!!");
        assertThat(DisplayLanguage.requestLanguage()).isEqualTo("en");
    }
    @Test void reminderCopyUsesSingularAndPluralForms() {
        assertThat(DisplayLanguage.dailyBody("en", 1)).contains("1 task and");
        assertThat(DisplayLanguage.dailyBody("es", 2)).contains("2 tareas");
        assertThat(DisplayLanguage.blockBody("en", 1)).isEqualTo("Starts in 1 minute.");
        assertThat(DisplayLanguage.blockBody("es", 15)).isEqualTo("Empieza en 15 minutos.");
        assertThat(DisplayLanguage.blockBody("es", 0)).isEqualTo("Es hora de empezar.");
    }
}
