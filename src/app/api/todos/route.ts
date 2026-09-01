import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAllTodos, createTodo } from "@/lib/inMemoryStore";

const useDb = !!process.env.DATABASE_URL;

export async function GET() {
  try {
    if (useDb) {
      const todos = await prisma.todo.findMany({
        orderBy: { createdAt: "desc" },
      });
      return NextResponse.json(todos);
    }
    return NextResponse.json(getAllTodos());
  } catch (error) {
    console.error("GET /api/todos error:", error);
    return NextResponse.json(
      { error: "Failed to fetch todos" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const title = (body?.title ?? "").toString().trim();
    if (!title) {
      return NextResponse.json(
        { error: "title is required" },
        { status: 400 }
      );
    }

    if (useDb) {
      const todo = await prisma.todo.create({
        data: { title },
      });
      return NextResponse.json(todo, { status: 201 });
    }

    const todo = createTodo(title);
    return NextResponse.json(todo, { status: 201 });
  } catch (error) {
    console.error("POST /api/todos error:", error);
    return NextResponse.json(
      { error: "Failed to create todo" },
      { status: 500 }
    );
  }
}
