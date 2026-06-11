import type {
  AdapterErrorEvent,
  AgentMessageDeltaNotification,
  ItemNotification,
  TurnCompletedNotification,
} from "./types.js";

export interface AdapterEventMap {
  itemStarted: ItemNotification;
  agentMessageDelta: AgentMessageDeltaNotification;
  itemCompleted: ItemNotification;
  turnCompleted: TurnCompletedNotification;
  /** Terminal: the agent process died or the connection is unusable. */
  error: AdapterErrorEvent;
}

export type AdapterEventName = keyof AdapterEventMap;

export type AdapterEventHandler<K extends AdapterEventName> = (
  payload: AdapterEventMap[K],
) => void;

export class TypedEventEmitter<EventMap extends object> {
  private readonly handlers = new Map<keyof EventMap, Set<(payload: never) => void>>();

  on<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void): void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as (payload: never) => void);
  }

  off<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void): void {
    this.handlers.get(event)?.delete(handler as (payload: never) => void);
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      (handler as (payload: EventMap[K]) => void)(payload);
    }
  }
}
