# Control API

By default, the API address is `http://127.0.0.1:13276/_control`.

The request and response content type should always be `application/json`, except for any request or request that doesn't have a payload.

`4XX` and `5XX` responses may include a `code` field to explain the reason for the failure, unless it's unambiguous from the HTTP status code. Either way, the daemon logs will include the exact failure reason, including any tracebacks.

## Endpoints

### Sync status (`/sync-status`)

This is a WebSocket endpoint. It doesn't take any input, and it outputs one of the following string frames which correspond to the new status as soon as it changes:

- `CONNECTED_TO_PUBLIC_GATEWAY`: The device is connected to the Internet and we can communicate with the public gateway.
- `CONNECTED_TO_COURIER`: The device is connected to the WiFi hotspot of a courier. The device may or may not have a sync in progress.
- `DISCONNECTED_FROM_ALL`: The device is not connected to the public gateway via the Internet or a courier. This status is also used if the device is connected to the Internet but the public gateway is unreachable (e.g., it's been blocked using DPI).

As soon as the connection is established, it outputs the last known status.

The server will never close the connection. If that happens, it'd be due to a bug.

### Public gateway (`/public-gateway`)

#### Get current gateway (`GET`)

This can only return a `200` response containing the `publicAddress`. For example:

```json
{"publicAddress": "braavos.relaycorp.cloud"}
```

#### Migrate public gateway (`PUT`)

The request payload MUST include the field `publicGateway` set to the public address of the new gateway. For example:

```json
{"publicAddress": "braavos.relaycorp.cloud"}
```

Possible responses:

- `204` if the migration completed successfully.
- `400` with one of the following `code`s:
  - `MALFORMED_ADDRESS`.
  - `INVALID_ADDRESS` if the DNS lookup and DNSSEC verification succeeded, but the address doesn't actually exist.
- `500` with one of the following `code`s:
  - `ADDRESS_RESOLUTION_FAILURE` if the DNS lookup or DNSSEC verification failed. **This would also happen if the device is disconnected from the Internet**.
  - `REGISTRATION_FAILURE` the address was valid, but the new public gateway failed to complete the registration. Retrying later might work.
