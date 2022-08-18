# Control API

By default, the API address is `http://127.0.0.1:13276/_control`.

The request and response content type should always be `application/json`, except for any request or request that doesn't have a payload.

`4XX` and `5XX` responses may include a `code` field to explain the reason for the failure, unless it's unambiguous from the HTTP status code. Either way, the daemon logs will include the exact failure reason, including any tracebacks.

## Authentication

When the daemon starts as a `fork`ed process, it will send the authentication token that the parent process should use when making requests to the Control API. This message has the following structure:

```json
{
  "type": "controlAuthToken",
  "value": "s3cr3t"
}
```

Requests to Control endpoints should include the `value` in the query string parameter `auth`. For example:

```
http://127.0.0.1:13276/_control/sub-path?auth=s3cr3t
```

When authentication fails, HTTP requests would result in `401` responses and WebSocket requests would be closed with the `1008` status code.

## Endpoints

### Sync status (`/sync-status`)

This is a WebSocket endpoint. It doesn't take any input, and it outputs one of the following string frames which correspond to the new status as soon as it changes:

- `CONNECTED_TO_INTERNET_GATEWAY`: The device is connected to the Internet and we can communicate with the Internet gateway.
- `CONNECTED_TO_COURIER`: The device is connected to the Wi-Fi hotspot of a courier. The device may or may not have a sync in progress.
- `DISCONNECTED`: The device is not connected to the Internet gateway via the Internet or a courier. This status is also used if the device is connected to the Internet but the Internet gateway is unreachable (e.g., it's been blocked using DPI).
- `UNREGISTERED`: This gateway hasn't yet registered with its Internet gateway. This typically means that the device has never connected to the Internet since the app was installed.

As soon as the connection is established, it outputs the last known status.

The server will never close the connection. If that happens, it'd be due to a bug.

This endpoint can be tested with the following client:

```typescript
import { source } from 'stream-to-it';
import WebSocket from 'ws';

async function main(): Promise<void> {
  for await (const status of streamStatuses()) {
    // tslint:disable-next-line:no-console
    console.log('Got status', status);
  }
}

async function* streamStatuses(): AsyncIterable<string> {
  const client = new WebSocket('http://127.0.0.1:13276/_control/sync-status', {
    authorization: 'Bearer s3cr3t',
  });
  const socketStream = WebSocket.createWebSocketStream(client, { encoding: 'utf-8' });
  yield* await source(socketStream);
}

main();
```

### Courier sync (`/courier-sync`)

This is a WebSocket endpoint. It doesn't take any input, and it outputs one of the following string frames which correspond to the new status as soon as it changes:

- `COLLECTION`: Cargo collection is about to start.
- `WAIT`: The wait period before the cargo collection is about to start.
- `DELIVERY`: Cargo delivery is about to start.

The server will close the connection as soon as the sync completes. The following WebSocket status codes are used:

- `1000` if the sync completed normally.
- `1011` if there was an internal server error.
- `4000` if this private gateway isn't yet registered with a Internet gateway. This is likely an error in the UI app, as it shouldn't have attempted a sync in this state.
- `4001` if the device isn't connected to the WiFi network of a courier.

This endpoint can be tested with the following client:

```typescript
import { source } from 'stream-to-it';
import WebSocket from 'ws';

async function main(): Promise<void> {
  for await (const status of streamStatuses()) {
    // tslint:disable-next-line:no-console
    console.log('Got status', status);
  }
}

async function* streamStatuses(): AsyncIterable<string> {
  const client = new WebSocket('http://127.0.0.1:13276/_control/courier-sync', {
    authorization: 'Bearer s3cr3t',
  });
  client.once('close', (code, reason) => {
    // tslint:disable-next-line:no-console
    console.log('Closing connection', code, reason);
  })
  const socketStream = WebSocket.createWebSocketStream(client, { encoding: 'utf-8' });
  yield* await source(socketStream);
}

main();
```

### Internet gateway (`/public-gateway`)

#### Get current gateway (`GET`)

This can only return a `200` response containing the `publicAddress`. For example:

```json
{"publicAddress": "braavos.relaycorp.cloud"}
```

#### Migrate Internet gateway (`PUT`)

The request payload MUST include the field `publicAddress` set to the public address of the new gateway. For example:

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
  - `REGISTRATION_FAILURE` the address was valid, but the new Internet gateway failed to complete the registration. Retrying later might work.
