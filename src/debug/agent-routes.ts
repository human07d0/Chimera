import { Request, Response, Router } from "express";

export const agentRouter: Router = Router();

agentRouter.get("/", (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      description: "Chimera Debug API — inspect and query recorded LLM API call payloads",
      endpoints: [
        {
          method: "GET",
          path: "/debug/calls",
          description: "List recent debug events with optional filtering",
          params: { limit: "number", offset: "number", model: "string", search: "string" },
        },
        {
          method: "GET",
          path: "/debug/calls/:id",
          description: "Get a single debug event by request ID",
          params: { id: "string" },
        },
        {
          method: "GET",
          path: "/debug/media/:requestId/:mediaId",
          description: "Retrieve a media attachment (image/audio/video) from a debug event",
        },
        {
          method: "POST",
          path: "/debug/prune",
          description: "Delete all stored debug events",
        },
      ],
      data_schema: {
        DebugEvent: {
          request_id: "string",
          ts_start: "number",
          ts_end: "number",
          path: "string",
          method: "string",
          status_code: "number",
          model_requested: "string",
          model_upstream: "string",
          provider_name: "string",
          stream: "boolean",
          request_body: "string",
          response_body: "string",
          error_type: "string | null",
          error_body: "string | null",
          media: "DebugMediaItem[] | undefined",
        },
        DebugMediaItem: {
          id: "string",
          location: "request | response",
          path: "string",
          kind: "image | audio | video | unknown",
          media_type: "string",
          encoding: "base64",
          byte_length: "number",
        },
      },
    },
  });
});
