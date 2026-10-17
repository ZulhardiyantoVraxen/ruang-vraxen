import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Kafka, Producer } from "kafkajs";
import { TOPICS, TopicName, PlatformEvent } from "@platform/shared";

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaService.name);
  private readonly kafka = new Kafka({
    clientId: "platform-api",
    brokers: (process.env.KAFKA_BROKERS ?? "localhost:9092").split(","),
  });
  private producer: Producer = this.kafka.producer();

  async onModuleInit() {
    await this.producer.connect();
  }

  async onModuleDestroy() {
    await this.producer.disconnect();
  }

  /**
   * Publish one event to its aggregate topic. `aggregateId` is always used as
   * the partition key, so every event for the same division/agent/task stays
   * ordered on the same partition - consumers never see e.g.
   * task.qa.failed before task.assigned for the same task.
   */
  async publish<TType extends string, TPayload>(
    topic: TopicName,
    event: Omit<PlatformEvent<TType, TPayload>, "occurredAt">,
  ) {
    const fullEvent: PlatformEvent<TType, TPayload> = {
      ...event,
      occurredAt: new Date().toISOString(),
    };
    await this.producer.send({
      topic,
      messages: [{ key: event.aggregateId, value: JSON.stringify(fullEvent) }],
    });
    this.logger.debug(`-> ${topic} ${event.eventType} (${event.aggregateId})`);
  }
}
