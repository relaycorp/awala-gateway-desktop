export enum ServerMessageType {
  TOKEN_MESSAGE = 'controlAuthToken',
}
export interface ServerMessage {
  readonly type: ServerMessageType;
  readonly value: string;
}
