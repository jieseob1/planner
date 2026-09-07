-- No Kubernetes metadata lookup: tags and the output schema are bounded here.
-- Do not add original records to the return value: it can contain secrets.
function sanitize(tag, timestamp, record)
  local message = record.log or record.message
  if type(message) ~= "string" then return -1, timestamp, {} end
  if record.logtag and record.logtag ~= "F" then return -1, timestamp, {} end
  local lower = message:lower()
  -- Drop complete sensitive lines, including JSON fields and Java map dumps.
  -- Dropping also avoids partial redaction when credentials contain spaces.
  local forbidden = {"authorization", "cookie", "password", "passwd", "client_secret",
    "clientsecret", "access_token", "refresh_token", "id_token", "credential",
    "accesstoken", "refreshtoken", "idtoken", "x-api-key", "x_api_key",
    "private key", "bearer ", "basic ", "request body", "response body"}
  for _, key in ipairs(forbidden) do
    if lower:find(key, 1, true) then return -1, timestamp, {} end
  end
  if lower:match("token[%s\"']*[:=]") or lower:match("secret[%s\"']*[:=]") or
      lower:match("api[_%-]?key[%s\"']*[:=]") then return -1, timestamp, {} end
  -- Remove query strings on absolute/relative URLs, even outside access logs.
  message = message:gsub("%?[^%s\"'<>]*", "?[REDACTED]")
  -- JWTs can occur outside named fields; match the shape without decoding them.
  message = message:gsub("eyJ[%w_%-]+%.[%w_%-]+%.[%w_%-]+", "[REDACTED_JWT]")
  message = message:gsub("(https?://)[^/%s]+@", "%1[REDACTED]@")
  -- Keep one bounded line, preserving stack frames and ordinary error messages.
  message = message:gsub("[%c]", " "):sub(1, 3000)
  local level = "info"
  if lower:find("error", 1, true) or lower:find("exception", 1, true) then level = "error"
  elseif lower:find("warn", 1, true) then level = "warn"
  elseif lower:find("debug", 1, true) then level = "debug" end
  local component = tag:match("^nowline%.([a-z]+)$")
  local allowed = {backend=true, frontend=true, keycloak=true, mysql=true}
  if not allowed[component] then return -1, timestamp, {} end
  return 2, timestamp, {message=message, level=level, component=component,
    stream=record.stream == "stderr" and "stderr" or "stdout"}
end
