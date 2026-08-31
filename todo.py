"""
CLI TODO List Manager
Usage:
  python todo.py add "タスク名" [--priority high|medium|low]   - TODOを追加
  python todo.py list             - 一覧表示（優先度順）
  python todo.py done <id>        - 完了マーク
  python todo.py delete <id>      - 削除
"""

import argparse
import json
import os
import sys
from datetime import datetime

TODO_FILE = "todos.json"

# 優先度の定義（高い順）
VALID_PRIORITIES = ["high", "medium", "low"]
PRIORITY_ORDER = {p: i for i, p in enumerate(VALID_PRIORITIES)}


# ---------------------------------------------------------------------------
# ストレージ層
# ---------------------------------------------------------------------------

def load_todos(filepath: str = TODO_FILE) -> list:
    """JSONファイルからTODOリストを読み込む。ファイルがなければ空リストを返す。"""
    if not os.path.exists(filepath):
        return []
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError:
        print(f"[警告] {filepath} のデータが破損しています。空のリストで起動します。")
        return []


def save_todos(todos: list, filepath: str = TODO_FILE) -> None:
    """TODOリストをJSONファイルに保存する。"""
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(todos, f, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# ビジネスロジック
# ---------------------------------------------------------------------------

def _next_id(todos: list) -> int:
    """未使用の最小IDを返す（削除後の欠番を再利用しない）。"""
    if not todos:
        return 1
    return max(t["id"] for t in todos) + 1


def add_todo(title: str, filepath: str = TODO_FILE, priority: str = "medium") -> dict:
    """TODOを追加して保存し、追加したアイテムを返す。"""
    title = title.strip()
    if not title:
        raise ValueError("タスク名が空です。タスク名を入力してください。")
    if priority not in VALID_PRIORITIES:
        raise ValueError(
            f"無効な優先度: '{priority}'。"
            f"有効な値は {', '.join(VALID_PRIORITIES)} のいずれかです。"
        )
    todos = load_todos(filepath)
    item = {
        "id": _next_id(todos),
        "title": title,
        "done": False,
        "priority": priority,
        "created_at": datetime.now().isoformat(timespec="seconds"),
    }
    todos.append(item)
    save_todos(todos, filepath)
    return item


def list_todos(filepath: str = TODO_FILE) -> list:
    """TODOリストを優先度順（high > medium > low）で返す。"""
    todos = load_todos(filepath)
    return sorted(todos, key=lambda t: PRIORITY_ORDER.get(t.get("priority", "medium"), 1))


def done_todo(todo_id: int, filepath: str = TODO_FILE) -> dict:
    """指定IDのTODOを完了状態にして保存し、更新アイテムを返す。"""
    todos = load_todos(filepath)
    for item in todos:
        if item["id"] == todo_id:
            if item["done"]:
                raise ValueError(f"ID {todo_id} のタスクはすでに完了しています。")
            item["done"] = True
            save_todos(todos, filepath)
            return item
    raise KeyError(f"ID {todo_id} のタスクが見つかりません。`python todo.py list` で一覧を確認してください。")


def delete_todo(todo_id: int, filepath: str = TODO_FILE) -> dict:
    """指定IDのTODOを削除して保存し、削除したアイテムを返す。"""
    todos = load_todos(filepath)
    for i, item in enumerate(todos):
        if item["id"] == todo_id:
            removed = todos.pop(i)
            save_todos(todos, filepath)
            return removed
    raise KeyError(f"ID {todo_id} のタスクが見つかりません。`python todo.py list` で一覧を確認してください。")


# ---------------------------------------------------------------------------
# 表示ヘルパー
# ---------------------------------------------------------------------------

PRIORITY_LABEL = {
    "high":   "[!高]",
    "medium": "[中]",
    "low":    "[低]",
}


def _format_item(item: dict) -> str:
    status = "[done]" if item["done"] else "[ -- ]"
    priority = item.get("priority", "medium")
    plabel = PRIORITY_LABEL.get(priority, "[中]")
    title = item["title"]
    if item["done"]:
        title = f"({title})"
    return f"  [{item['id']:>3}] {status} {plabel}  {title}"


def print_list(todos: list) -> None:
    if not todos:
        print("TODO はまだありません。`python todo.py add \"タスク名\"` で追加できます。")
        return
    total = len(todos)
    done_count = sum(1 for t in todos if t["done"])
    print(f"\n--- TODO一覧 ({done_count}/{total} 完了) ---\n")
    for item in todos:
        print(_format_item(item))
    print()


# ---------------------------------------------------------------------------
# CLIパーサー
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="todo.py",
        description="シンプルなCLI TODOリストマネージャー",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""使用例:
  python todo.py add "牛乳を買う"
  python todo.py add "重要な会議" --priority high
  python todo.py list
  python todo.py done 1
  python todo.py delete 1""",
    )
    sub = parser.add_subparsers(dest="command", metavar="コマンド")

    # add
    p_add = sub.add_parser("add", help="TODOを追加する")
    p_add.add_argument("title", help="タスク名")
    p_add.add_argument(
        "--priority",
        choices=VALID_PRIORITIES,
        default="medium",
        help="優先度 (high/medium/low, デフォルト: medium)",
    )

    # list
    sub.add_parser("list", help="TODO一覧を表示する（優先度順）")

    # done
    p_done = sub.add_parser("done", help="TODOを完了にする")
    p_done.add_argument("id", type=int, help="完了にするTODOのID")

    # delete
    p_delete = sub.add_parser("delete", help="TODOを削除する")
    p_delete.add_argument("id", type=int, help="削除するTODOのID")

    return parser


# ---------------------------------------------------------------------------
# メインエントリーポイント
# ---------------------------------------------------------------------------

def main(args=None) -> int:
    """メイン処理。終了コードを返す。"""
    parser = build_parser()
    parsed = parser.parse_args(args)

    if parsed.command is None:
        parser.print_help()
        return 1

    filepath = TODO_FILE  # モジュール変数を参照（テストで monkeypatch 可能）

    try:
        if parsed.command == "add":
            item = add_todo(parsed.title, filepath, parsed.priority)
            plabel = PRIORITY_LABEL.get(item["priority"], "[中]")
            print(f"[追加] [{item['id']}] {plabel} {item['title']}")

        elif parsed.command == "list":
            todos = list_todos(filepath)
            print_list(todos)

        elif parsed.command == "done":
            item = done_todo(parsed.id, filepath)
            print(f"[完了] [{item['id']}] {item['title']}")

        elif parsed.command == "delete":
            item = delete_todo(parsed.id, filepath)
            print(f"[削除] [{item['id']}] {item['title']}")

    except (KeyError, ValueError) as e:
        print(f"❌ エラー: {e}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
