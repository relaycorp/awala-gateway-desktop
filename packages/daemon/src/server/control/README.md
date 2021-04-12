# Control API

By default, the API address is `http://127.0.0.1:13276/_control`.

The request and response content type should always be `application/json`, except for WebSocket connections.

`4XX` and `5XX` responses may include a `code` field to explain the reason for the failure, unless it's unambiguous from the HTTP status code. Either way, the daemon logs will include the exact failure reason, including any tracebacks.

## Endpoints

### Public gateway (`/public-gateway`)

#### Migrate public gateway (`PUT`)

Possible responses:

- `204` if the migration completed successfully.
- `400` with one of the following `code`s:
  - `MALFORMED_ADDRESS`.
  - `INVALID_ADDRESS` if the DNS lookup and DNSSEC verification succeeded, but the address doesn't actually exist.
- `500` with one of the following `code`s:
  - `ADDRESS_RESOLUTION_FAILURE` if the DNS lookup or DNSSEC verification failed. **This would also happen if the device is disconnected from the Internet**.
  - `REGISTRATION_FAILURE` the address was valid, but the new public gateway failed to complete the registration. Retrying later might work.

#### Migrate public gateway (PUT)
