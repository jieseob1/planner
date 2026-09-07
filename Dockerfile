FROM nginx:1.29.3-alpine3.22

COPY nginx.conf /etc/nginx/nginx.conf
COPY --chown=101:101 dist /usr/share/nginx/html

USER 101:101

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -q -T 2 -O - http://127.0.0.1:8080/healthz | grep -qx ok

CMD ["nginx", "-g", "daemon off;"]
