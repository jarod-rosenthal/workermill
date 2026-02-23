/**
 * TypeORM Entity Subscriber that transparently encrypts/decrypts
 * the encryptedValue field on OrgCredential entities.
 *
 * Encrypts before INSERT/UPDATE, decrypts after SELECT.
 * Follows the OrganizationEncryptionSubscriber pattern exactly.
 */

import {
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  UpdateEvent,
  LoadEvent,
} from "typeorm";
import { OrgCredential } from "../../models/OrgCredential.js";
import { encrypt, decrypt } from "../../utils/encryption.js";

@EventSubscriber()
export class OrgCredentialEncryptionSubscriber
  implements EntitySubscriberInterface<OrgCredential>
{
  listenTo() {
    return OrgCredential;
  }

  afterLoad(entity: OrgCredential, _event?: LoadEvent<OrgCredential>): void {
    if (entity.encryptedValue && typeof entity.encryptedValue === "string") {
      entity.encryptedValue = decrypt(entity.encryptedValue);
    }
  }

  beforeInsert(event: InsertEvent<OrgCredential>): void {
    if (
      event.entity.encryptedValue &&
      typeof event.entity.encryptedValue === "string"
    ) {
      event.entity.encryptedValue = encrypt(event.entity.encryptedValue);
    }
  }

  beforeUpdate(event: UpdateEvent<OrgCredential>): void {
    if (event.entity) {
      const entity = event.entity as OrgCredential;
      if (entity.encryptedValue && typeof entity.encryptedValue === "string") {
        entity.encryptedValue = encrypt(entity.encryptedValue);
      }
    }
  }
}
