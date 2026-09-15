// Health identities remain stable; current state is checked against immutable revisions.
export const HEALTH_SCHEMA = `
CREATE TABLE registry_health_records (
 id TEXT PRIMARY KEY,
 entity TEXT NOT NULL CHECK(entity IN ('visits','examinations','cases','products','plans','tasks','administrations','results','costs')),
 animal_id TEXT REFERENCES registry_animals(id),
 revision INTEGER NOT NULL CHECK(revision > 0),
 data TEXT NOT NULL CHECK(json_valid(data))
);
CREATE INDEX registry_health_animal ON registry_health_records(animal_id,entity);
CREATE TABLE registry_health_revisions (
 id TEXT PRIMARY KEY,
 record_id TEXT NOT NULL REFERENCES registry_health_records(id),
 revision INTEGER NOT NULL,
 operation TEXT NOT NULL,
 reason TEXT,
 before_json TEXT,
 after_json TEXT NOT NULL CHECK(json_valid(after_json)),
 provenance TEXT NOT NULL CHECK(json_valid(provenance)),
 recorded_at TEXT NOT NULL,
 UNIQUE(record_id,revision)
);
CREATE TRIGGER registry_health_revisions_no_update BEFORE UPDATE ON registry_health_revisions
 BEGIN SELECT RAISE(ABORT,'health revisions are append-only'); END;
CREATE TRIGGER registry_health_revisions_no_delete BEFORE DELETE ON registry_health_revisions
 BEGIN SELECT RAISE(ABORT,'health revisions are append-only'); END;
CREATE TABLE registry_health_requests (id TEXT PRIMARY KEY, hash TEXT NOT NULL, response TEXT NOT NULL);
CREATE TABLE registry_health_attachments (
 id TEXT PRIMARY KEY, filename TEXT NOT NULL, mime TEXT NOT NULL,
 checksum TEXT NOT NULL, bytes BLOB NOT NULL, recorded_at TEXT NOT NULL, recorded_by TEXT NOT NULL
);
CREATE TABLE registry_health_attachment_links (
 attachment_id TEXT NOT NULL REFERENCES registry_health_attachments(id),
 record_id TEXT NOT NULL REFERENCES registry_health_records(id),
 revision INTEGER NOT NULL,
 PRIMARY KEY(attachment_id,record_id,revision)
);
CREATE TRIGGER registry_health_links_no_update BEFORE UPDATE ON registry_health_attachment_links
 BEGIN SELECT RAISE(ABORT,'health attachment links are append-only'); END;
CREATE TRIGGER registry_health_links_no_delete BEFORE DELETE ON registry_health_attachment_links
 BEGIN SELECT RAISE(ABORT,'health attachment links are append-only'); END;
CREATE TRIGGER registry_health_bytes_no_delete BEFORE DELETE ON registry_health_attachments
 WHEN EXISTS(SELECT 1 FROM registry_health_attachment_links WHERE attachment_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'linked health attachment bytes are immutable'); END;
CREATE TRIGGER registry_health_bytes_no_update BEFORE UPDATE ON registry_health_attachments
 BEGIN SELECT RAISE(ABORT,'health attachment bytes are immutable'); END;
`;
export const HEALTH_TABLES = [
  "registry_health_records",
  "registry_health_revisions",
  "registry_health_requests",
  "registry_health_attachments",
  "registry_health_attachment_links",
] as const;
