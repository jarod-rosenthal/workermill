/**
 * TypeORM Entity Subscriber that transparently encrypts/decrypts
 * the webhookSecret field on the WebhookEndpoint entity.
 *
 * Encrypts before INSERT/UPDATE, decrypts after SELECT.
 * This ensures webhook secrets are encrypted at rest in PostgreSQL.
 */

import {
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  UpdateEvent,
  LoadEvent,
} from "typeorm";
import { WebhookEndpoint } from "../../models/WebhookEndpoint.js";
import { encrypt, decrypt } from "../../utils/encryption.js";

@EventSubscriber()
export class WebhookEndpointEncryptionSubscriber
  implements EntitySubscriberInterface<WebhookEndpoint>
{
  listenTo() {
    return WebhookEndpoint;
  }

  /**
   * Decrypt webhookSecret after loading from the database.
   */
  afterLoad(entity: WebhookEndpoint, _event?: LoadEvent<WebhookEndpoint>): void {
    if (entity.webhookSecret && typeof entity.webhookSecret === "string") {
      entity.webhookSecret = decrypt(entity.webhookSecret);
    }
  }

  /**
   * Encrypt webhookSecret before inserting into the database.
   */
  beforeInsert(event: InsertEvent<WebhookEndpoint>): void {
    if (
      event.entity.webhookSecret &&
      typeof event.entity.webhookSecret === "string"
    ) {
      event.entity.webhookSecret = encrypt(event.entity.webhookSecret);
    }
  }

  /**
   * Encrypt webhookSecret before updating in the database.
   */
  beforeUpdate(event: UpdateEvent<WebhookEndpoint>): void {
    if (event.entity) {
      const entity = event.entity as WebhookEndpoint;
      if (entity.webhookSecret && typeof entity.webhookSecret === "string") {
        entity.webhookSecret = encrypt(entity.webhookSecret);
      }
    }
  }
}
