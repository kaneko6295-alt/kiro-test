import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateTodo, deleteTodo } from "@/lib/inMemoryStore";

const useDb = !!process.env.DATABASE_URL;

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = await request.json();
    const data: { title?: string; completed?: boolean } = {};
    if (typeof body?.title === "string") data.title = body.title.trim();
    if (typeof body?.completed === "boolean") data.completed = body.completed;

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    if (useDb) {
      try {
        const todo = await prisma.todo.update({
          where: { id },
          data,
        });
        return NextResponse.json(todo);
      } catch {
        return NextResponse.json({ error: "Todo not found" }, { status: 404 });
      }
    }

    const todo = updateTodo(id, data);
    if (!todo) {
      return NextResponse.json({ error: "Todo not found" }, { status: 404 });
    }
    return NextResponse.json(todo);
  } catch (error) {
    console.error("PATCH /api/todos/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to update todo" },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;

    if (useDb) {
      try {
        await prisma.todo.delete({ where: { id } });
        return new NextResponse(null, { status: 204 });
      } catch {
        return NextResponse.json({ error: "Todo not found" }, { status: 404 });
      }
    }

    const deleted = deleteTodo(id);
    if (!deleted) {
      return NextResponse.json({ error: "Todo not found" }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("DELETE /api/todos/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to delete todo" },
      { status: 500 }
    );
  }
}
