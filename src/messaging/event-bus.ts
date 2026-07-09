import { Injectable } from '@nestjs/common';

export interface IntegrationEvent {
  id: string; // the outbox row id — consumers dedupe on this
  type: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

export type EventHandler = (event: IntegrationEvent) => void | Promise<void>;

/**
 * In-memory broker stub. Swapped for RabbitMQ in a later phase. Delivery is
 * at-least-once (the relay may re-publish after a crash), so handlers must be
 * idempotent — dedupe on `event.id`.
 */
@Injectable()
export class EventBus {
  private readonly handlers = new Set<EventHandler>();

  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async publish(event: IntegrationEvent): Promise<void> {
    for (const handler of this.handlers) {
      await handler(event);
    }
  }
}
