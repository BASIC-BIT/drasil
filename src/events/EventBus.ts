// src/events/EventBus.ts

import { EventEmitter } from 'events';
import { injectable } from 'inversify';
import { EventName, EventMap } from './events'; // Import our defined types

export interface IEventBus {
  publish<K extends EventName>(eventName: K, payload: EventMap[K]): void;
  subscribe<K extends EventName>(eventName: K, handler: (payload: EventMap[K]) => void): void;
  unsubscribe<K extends EventName>(eventName: K, handler: (payload: EventMap[K]) => void): void;
}

@injectable()
export class EventBus implements IEventBus {
  private emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
    // Increase max listeners if needed, default is 10
    this.emitter.setMaxListeners(20);
    console.log('EventBus initialized');
  }

  /**
   * Publishes an event with its payload.
   * @param eventName The name of the event to publish.
   * @param payload The data associated with the event.
   */
  public publish<K extends EventName>(eventName: K, payload: EventMap[K]): void {
    console.log(`Publishing event: ${eventName}`, JSON.stringify(payload, null, 2)); // Log payload for debugging
    this.emitter.emit(eventName, payload);
  }

  /**
   * Subscribes a handler function to an event.
   * @param eventName The name of the event to subscribe to.
   * @param handler The function to execute when the event is published.
   */
  public subscribe<K extends EventName>(
    eventName: K,
    handler: (payload: EventMap[K]) => void
  ): void {
    console.log(`Subscribing to event: ${eventName}`); // Add logging
    this.emitter.on(eventName, handler);
  }

  /**
   * Unsubscribes a handler function from an event.
   * @param eventName The name of the event to unsubscribe from.
   * @param handler The handler function to remove.
   */
  public unsubscribe<K extends EventName>(
    eventName: K,
    handler: (payload: EventMap[K]) => void
  ): void {
    console.log(`Unsubscribing from event: ${eventName}`); // Add logging
    this.emitter.off(eventName, handler);
  }
}
