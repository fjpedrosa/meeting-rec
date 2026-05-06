import { db } from "../db";

// Types
interface TagRow {
  id: number;
  name: string;
  color: string;
  created_at: string;
}

interface TagWithCountRow extends TagRow {
  meeting_count: number;
}

// Prepared statements
const listTagsStmt = db.prepare<TagWithCountRow, []>(`
  SELECT t.id, t.name, t.color, t.created_at,
         COUNT(mt.meeting_id) as meeting_count
  FROM tags t
  LEFT JOIN meeting_tags mt ON t.id = mt.tag_id
  GROUP BY t.id
  ORDER BY t.name
`);

const getTagStmt = db.prepare<TagRow, [number]>(`
  SELECT id, name, color, created_at FROM tags WHERE id = ?
`);

const insertTagStmt = db.prepare<TagRow, [string, string]>(`
  INSERT INTO tags (name, color) VALUES (?, ?)
  RETURNING id, name, color, created_at
`);

const checkTagNameStmt = db.prepare<{ count: number }, [string]>(`
  SELECT COUNT(*) as count FROM tags WHERE name = ?
`);

const checkTagNameExcludingStmt = db.prepare<{ count: number }, [string, number]>(`
  SELECT COUNT(*) as count FROM tags WHERE name = ? AND id != ?
`);

const updateTagStmt = db.prepare(`
  UPDATE tags SET name = ?, color = ? WHERE id = ?
`);

const deleteTagStmt = db.prepare(`
  DELETE FROM tags WHERE id = ?
`);

const assignTagStmt = db.prepare(`
  INSERT OR IGNORE INTO meeting_tags (meeting_id, tag_id) VALUES (?, ?)
`);

const removeTagStmt = db.prepare(`
  DELETE FROM meeting_tags WHERE meeting_id = ? AND tag_id = ?
`);

const checkMeetingExistsStmt = db.prepare<{ id: number }, [number]>(`
  SELECT id FROM meetings WHERE id = ?
`);

/**
 * GET /api/tags
 */
export const handleGetTags = (_req: Request): Response => {
  try {
    const tags = listTagsStmt.all();
    return Response.json({
      success: true,
      data: tags.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        createdAt: t.created_at,
        meetingCount: t.meeting_count,
      })),
      count: tags.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
};

/**
 * POST /api/tags
 * Body: { name: string, color?: string }
 */
export const handleCreateTag = async (req: Request): Promise<Response> => {
  try {
    const body = await req.json();

    if (!body.name || typeof body.name !== "string") {
      return Response.json(
        { success: false, error: "Name is required" },
        { status: 400 }
      );
    }

    const name = body.name.trim();
    if (name.length === 0) {
      return Response.json(
        { success: false, error: "Name cannot be empty" },
        { status: 400 }
      );
    }

    const existing = checkTagNameStmt.get(name);
    if (existing && existing.count > 0) {
      return Response.json(
        { success: false, error: "A tag with this name already exists" },
        { status: 409 }
      );
    }

    const color = typeof body.color === "string" ? body.color.trim() : "#6b7280";
    const tag = insertTagStmt.get(name, color);

    if (!tag) {
      return Response.json(
        { success: false, error: "Failed to create tag" },
        { status: 500 }
      );
    }

    return Response.json(
      {
        success: true,
        data: {
          id: tag.id,
          name: tag.name,
          color: tag.color,
          createdAt: tag.created_at,
          meetingCount: 0,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
};

/**
 * PATCH /api/tags/:id
 * Body: { name?: string, color?: string }
 */
export const handleUpdateTag = async (req: Request): Promise<Response> => {
  try {
    const url = new URL(req.url);
    const idMatch = url.pathname.match(/\/api\/tags\/(\d+)$/);
    if (!idMatch) {
      return Response.json({ success: false, error: "Invalid tag ID" }, { status: 400 });
    }

    const id = parseInt(idMatch[1], 10);
    const tag = getTagStmt.get(id);
    if (!tag) {
      return Response.json({ success: false, error: "Tag not found" }, { status: 404 });
    }

    const body = await req.json();
    const name = typeof body.name === "string" ? body.name.trim() : tag.name;
    const color = typeof body.color === "string" ? body.color.trim() : tag.color;

    if (name.length === 0) {
      return Response.json({ success: false, error: "Name cannot be empty" }, { status: 400 });
    }

    if (name !== tag.name) {
      const existing = checkTagNameExcludingStmt.get(name, id);
      if (existing && existing.count > 0) {
        return Response.json(
          { success: false, error: "A tag with this name already exists" },
          { status: 409 }
        );
      }
    }

    updateTagStmt.run(name, color, id);
    const updated = getTagStmt.get(id);

    return Response.json({
      success: true,
      data: {
        id: updated!.id,
        name: updated!.name,
        color: updated!.color,
        createdAt: updated!.created_at,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
};

/**
 * DELETE /api/tags/:id
 */
export const handleDeleteTag = (req: Request): Response => {
  try {
    const url = new URL(req.url);
    const idMatch = url.pathname.match(/\/api\/tags\/(\d+)$/);
    if (!idMatch) {
      return Response.json({ success: false, error: "Invalid tag ID" }, { status: 400 });
    }

    const id = parseInt(idMatch[1], 10);
    const tag = getTagStmt.get(id);
    if (!tag) {
      return Response.json({ success: false, error: "Tag not found" }, { status: 404 });
    }

    deleteTagStmt.run(id);
    return Response.json({ success: true, data: { id } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
};

/**
 * POST /api/meetings/:id/tags
 * Body: { tagId: number }
 */
export const handleAssignTag = async (req: Request): Promise<Response> => {
  try {
    const url = new URL(req.url);
    const idMatch = url.pathname.match(/\/api\/meetings\/(\d+)\/tags$/);
    if (!idMatch) {
      return Response.json({ success: false, error: "Invalid meeting ID" }, { status: 400 });
    }

    const meetingId = parseInt(idMatch[1], 10);
    const meeting = checkMeetingExistsStmt.get(meetingId);
    if (!meeting) {
      return Response.json({ success: false, error: "Meeting not found" }, { status: 404 });
    }

    const body = await req.json();
    if (!body.tagId || typeof body.tagId !== "number") {
      return Response.json({ success: false, error: "tagId is required" }, { status: 400 });
    }

    const tag = getTagStmt.get(body.tagId);
    if (!tag) {
      return Response.json({ success: false, error: "Tag not found" }, { status: 404 });
    }

    assignTagStmt.run(meetingId, body.tagId);

    return Response.json({
      success: true,
      data: { meetingId, tagId: body.tagId },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
};

/**
 * DELETE /api/meetings/:id/tags/:tagId
 */
export const handleRemoveTag = (req: Request): Response => {
  try {
    const url = new URL(req.url);
    const match = url.pathname.match(/\/api\/meetings\/(\d+)\/tags\/(\d+)$/);
    if (!match) {
      return Response.json({ success: false, error: "Invalid IDs" }, { status: 400 });
    }

    const meetingId = parseInt(match[1], 10);
    const tagId = parseInt(match[2], 10);

    removeTagStmt.run(meetingId, tagId);

    return Response.json({
      success: true,
      data: { meetingId, tagId },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
};
