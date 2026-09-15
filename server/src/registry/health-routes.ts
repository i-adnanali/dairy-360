import express, { type Request, type Response } from "express";
import type { Db } from "./schema";
import {
  healthEntity,
  healthObject,
  healthGet,
  healthList,
  healthSave,
  healthVoid,
  healthTaskAction,
  healthRound,
  healthRequest,
  healthUpload,
  HealthError,
} from "./health";
import { animalHealth, healthBoard, lifeReport } from "./health-reads";
export function healthRouter(db: Db) {
  const router = express.Router();
  const read =
    (fn: (req: Request, res: Response) => unknown) =>
    (req: Request, res: Response) => {
      try {
        fn(req, res);
      } catch (e) {
        if (e instanceof HealthError) res.status(e.status).json(e.toWire());
        else {
          console.error(e);
          res.status(500).json({
            error: "health_server_error",
            message:
              "The health request failed. No successful save was confirmed.",
          });
        }
      }
    };
  const write = (fn: (req: Request, b: Record<string, any>) => unknown) =>
    read((req, res) => {
      const b = healthObject(req.body);
      res.json(
        healthRequest(
          db,
          req.header("Idempotency-Key") ?? "",
          req.path,
          b,
          () => fn(req, b),
        ),
      );
    });
  router.get(
    "/health/board",
    read((req, res) =>
      res.json(
        healthBoard(
          db,
          req.query.on as string | undefined,
          req.query.time as string | undefined,
        ),
      ),
    ),
  );
  router.get(
    "/animals/:id/health",
    read((req, res) => res.json(animalHealth(db, req.params.id))),
  );
  router.get(
    "/animals/:id/life-report",
    read((req, res) =>
      res.json(
        lifeReport(db, req.params.id, {
          from: req.query.from as string | undefined,
          to: req.query.to as string | undefined,
          corrections: req.query.corrections === "true",
        }),
      ),
    ),
  );
  router.post(
    "/health/rounds",
    write((_req, b) => healthRound(db, b)),
  );
  router.post(
    "/health/attachments",
    write((_req, b) => healthUpload(db, b)),
  );
  router.get(
    "/health/attachments/:id",
    read((req, res) => {
      const a = db
        .prepare("SELECT * FROM registry_health_attachments WHERE id=?")
        .get(req.params.id) as any;
      if (!a)
        throw new HealthError("health_not_found", "Attachment not found.", 404);
      res
        .set({
          "Content-Type": a.mime,
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
          "Cache-Control": "no-store",
        })
        .send(a.bytes);
    }),
  );
  router.post(
    "/health/tasks/:id/actions",
    write((req, b) => healthTaskAction(db, req.params.id, b)),
  );
  router.get(
    "/health/:entity",
    read((req, res) =>
      res.json(
        healthList(
          db,
          healthEntity(req.params.entity),
          req.query.animal_id as string | undefined,
          req.query.history === "true",
        ),
      ),
    ),
  );
  router.get(
    "/health/:entity/:id/revisions",
    read((req, res) => {
      const r = healthGet(db, req.params.id);
      if (r.entity !== healthEntity(req.params.entity))
        throw new HealthError("health_not_found", "Record not found.", 404);
      res.json(
        db
          .prepare(
            "SELECT * FROM registry_health_revisions WHERE record_id=? ORDER BY revision",
          )
          .all(r.id),
      );
    }),
  );
  router.get(
    "/health/:entity/:id",
    read((req, res) => {
      const r = healthGet(db, req.params.id);
      if (r.entity !== healthEntity(req.params.entity))
        throw new HealthError("health_not_found", "Record not found.", 404);
      res.json(r);
    }),
  );
  router.post(
    "/health/:entity",
    write((req, b) => healthSave(db, healthEntity(req.params.entity), b)),
  );
  router.post(
    "/health/:entity/:id/revise",
    write((req, b) =>
      healthSave(db, healthEntity(req.params.entity), b, req.params.id),
    ),
  );
  router.post(
    "/health/:entity/:id/void",
    write((req, b) => {
      if (
        healthGet(db, req.params.id).entity !== healthEntity(req.params.entity)
      )
        throw new HealthError("health_not_found", "Record not found.", 404);
      return healthVoid(db, req.params.id, b);
    }),
  );
  return router;
}
