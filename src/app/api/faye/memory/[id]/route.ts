import { handleDelete, handleEdit } from "@/lib/faye/memory/handlers";
import { realDeps } from "@/lib/faye/memory/deps";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** PATCH /api/faye/memory/{id} - edit the words or the category of one note. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handleEdit(request, id, realDeps());
}

/** DELETE /api/faye/memory/{id}[?permanent=1] - delete one note (undo for a few minutes, or permanent at once). */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handleDelete(request, id, realDeps());
}
