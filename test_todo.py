"""
pytest テストスイート for todo.py

カバレッジ:
  - ストレージ層: load_todos / save_todos
  - ロジック層: add_todo / list_todos / done_todo / delete_todo
  - CLIインターフェース: 各サブコマンドの正常系・異常系
  - 統合テスト: add → list → done → list → delete のフロー
  - 優先度機能: 優先度の追加・バリデーション・ソート・表示
"""

import json
import os
import pytest

import todo as t


# ---------------------------------------------------------------------------
# フィクスチャ
# ---------------------------------------------------------------------------

@pytest.fixture
def tmp_file(tmp_path):
    """テスト用の一時JSONファイルパスを返す（存在しない状態で渡す）。"""
    return str(tmp_path / "todos.json")


@pytest.fixture
def populated_file(tmp_file):
    """2件のTODOが入った一時ファイルを返す。"""
    t.add_todo("タスクA", tmp_file)
    t.add_todo("タスクB", tmp_file)
    return tmp_file


# ---------------------------------------------------------------------------
# ストレージ層テスト
# ---------------------------------------------------------------------------

class TestLoadTodos:
    def test_returns_empty_list_when_file_missing(self, tmp_file):
        todos = t.load_todos(tmp_file)
        assert todos == []

    def test_returns_saved_data(self, tmp_file):
        data = [{"id": 1, "title": "test", "done": False, "priority": "medium", "created_at": "2024-01-01T00:00:00"}]
        with open(tmp_file, "w", encoding="utf-8") as f:
            json.dump(data, f)
        todos = t.load_todos(tmp_file)
        assert todos == data

    def test_returns_empty_list_on_corrupt_json(self, tmp_file, capsys):
        with open(tmp_file, "w", encoding="utf-8") as f:
            f.write("{ this is not valid json }")
        todos = t.load_todos(tmp_file)
        assert todos == []
        captured = capsys.readouterr()
        assert "警告" in captured.out


class TestSaveTodos:
    def test_saves_and_reloads(self, tmp_file):
        data = [{"id": 1, "title": "保存テスト", "done": False, "priority": "high", "created_at": "2024-01-01T00:00:00"}]
        t.save_todos(data, tmp_file)
        loaded = t.load_todos(tmp_file)
        assert loaded == data

    def test_creates_file_if_not_exists(self, tmp_file):
        assert not os.path.exists(tmp_file)
        t.save_todos([], tmp_file)
        assert os.path.exists(tmp_file)

    def test_overwrites_existing_file(self, tmp_file):
        t.save_todos([{"id": 1, "title": "old", "done": False, "priority": "low", "created_at": ""}], tmp_file)
        t.save_todos([], tmp_file)
        assert t.load_todos(tmp_file) == []


# ---------------------------------------------------------------------------
# ロジック層テスト
# ---------------------------------------------------------------------------

class TestAddTodo:
    def test_add_returns_item(self, tmp_file):
        item = t.add_todo("買い物", tmp_file)
        assert item["title"] == "買い物"
        assert item["done"] is False
        assert item["id"] == 1
        assert "created_at" in item

    def test_add_persists_to_file(self, tmp_file):
        t.add_todo("タスク1", tmp_file)
        todos = t.load_todos(tmp_file)
        assert len(todos) == 1
        assert todos[0]["title"] == "タスク1"

    def test_add_increments_id(self, tmp_file):
        t.add_todo("A", tmp_file)
        t.add_todo("B", tmp_file)
        todos = t.load_todos(tmp_file)
        assert todos[0]["id"] == 1
        assert todos[1]["id"] == 2

    def test_add_strips_whitespace(self, tmp_file):
        item = t.add_todo("  スペース付き  ", tmp_file)
        assert item["title"] == "スペース付き"

    def test_add_raises_on_empty_title(self, tmp_file):
        with pytest.raises(ValueError, match="空"):
            t.add_todo("", tmp_file)

    def test_add_raises_on_whitespace_only_title(self, tmp_file):
        with pytest.raises(ValueError, match="空"):
            t.add_todo("   ", tmp_file)

    # --- 優先度テスト ---

    def test_add_default_priority_is_medium(self, tmp_file):
        item = t.add_todo("デフォルト優先度", tmp_file)
        assert item["priority"] == "medium"

    def test_add_with_high_priority(self, tmp_file):
        item = t.add_todo("高優先度タスク", tmp_file, priority="high")
        assert item["priority"] == "high"

    def test_add_with_low_priority(self, tmp_file):
        item = t.add_todo("低優先度タスク", tmp_file, priority="low")
        assert item["priority"] == "low"

    def test_add_priority_persists_to_file(self, tmp_file):
        t.add_todo("保存テスト", tmp_file, priority="high")
        todos = t.load_todos(tmp_file)
        assert todos[0]["priority"] == "high"

    def test_add_raises_on_invalid_priority(self, tmp_file):
        with pytest.raises(ValueError, match="無効な優先度"):
            t.add_todo("タスク", tmp_file, priority="urgent")

    def test_all_valid_priorities(self, tmp_file):
        for p in t.VALID_PRIORITIES:
            item = t.add_todo(f"{p}タスク", tmp_file, priority=p)
            assert item["priority"] == p


class TestListTodos:
    def test_returns_empty_list_when_no_todos(self, tmp_file):
        todos = t.list_todos(tmp_file)
        assert todos == []

    def test_returns_all_todos(self, populated_file):
        todos = t.list_todos(populated_file)
        assert len(todos) == 2

    def test_list_sorted_by_priority(self, tmp_file):
        """high > medium > low の順にソートされること。"""
        t.add_todo("低", tmp_file, priority="low")
        t.add_todo("高", tmp_file, priority="high")
        t.add_todo("中", tmp_file, priority="medium")
        todos = t.list_todos(tmp_file)
        assert todos[0]["priority"] == "high"
        assert todos[1]["priority"] == "medium"
        assert todos[2]["priority"] == "low"

    def test_list_same_priority_preserves_relative_order(self, tmp_file):
        """同一優先度内では元の順序が維持されること。"""
        t.add_todo("A", tmp_file, priority="medium")
        t.add_todo("B", tmp_file, priority="medium")
        todos = t.list_todos(tmp_file)
        assert todos[0]["title"] == "A"
        assert todos[1]["title"] == "B"


class TestDoneTodo:
    def test_done_marks_item(self, populated_file):
        item = t.done_todo(1, populated_file)
        assert item["done"] is True

    def test_done_persists_to_file(self, populated_file):
        t.done_todo(1, populated_file)
        todos = t.load_todos(populated_file)
        assert todos[0]["done"] is True

    def test_done_does_not_affect_other_items(self, populated_file):
        t.done_todo(1, populated_file)
        todos = t.load_todos(populated_file)
        assert todos[1]["done"] is False

    def test_done_raises_on_nonexistent_id(self, populated_file):
        with pytest.raises(KeyError, match="999"):
            t.done_todo(999, populated_file)

    def test_done_raises_if_already_done(self, populated_file):
        t.done_todo(1, populated_file)
        with pytest.raises(ValueError, match="すでに完了"):
            t.done_todo(1, populated_file)


class TestDeleteTodo:
    def test_delete_removes_item(self, populated_file):
        t.delete_todo(1, populated_file)
        todos = t.load_todos(populated_file)
        assert len(todos) == 1
        assert todos[0]["id"] == 2

    def test_delete_returns_removed_item(self, populated_file):
        item = t.delete_todo(1, populated_file)
        assert item["id"] == 1
        assert item["title"] == "タスクA"

    def test_delete_raises_on_nonexistent_id(self, populated_file):
        with pytest.raises(KeyError, match="999"):
            t.delete_todo(999, populated_file)

    def test_delete_persists_to_file(self, populated_file):
        t.delete_todo(2, populated_file)
        todos = t.load_todos(populated_file)
        assert all(item["id"] != 2 for item in todos)


# ---------------------------------------------------------------------------
# CLIテスト
# ---------------------------------------------------------------------------

class TestCLI:
    def test_add_command(self, tmp_file, monkeypatch, capsys):
        monkeypatch.setattr(t, "TODO_FILE", tmp_file)
        result = t.main(["add", "CLIタスク"])
        assert result == 0
        captured = capsys.readouterr()
        assert "CLIタスク" in captured.out

    def test_add_command_with_priority(self, tmp_file, monkeypatch, capsys):
        monkeypatch.setattr(t, "TODO_FILE", tmp_file)
        result = t.main(["add", "重要タスク", "--priority", "high"])
        assert result == 0
        captured = capsys.readouterr()
        assert "重要タスク" in captured.out
        assert "!高" in captured.out

    def test_add_command_default_priority_is_medium(self, tmp_file, monkeypatch, capsys):
        monkeypatch.setattr(t, "TODO_FILE", tmp_file)
        t.main(["add", "デフォルト"])
        todos = t.load_todos(tmp_file)
        assert todos[0]["priority"] == "medium"

    def test_list_command_empty(self, tmp_file, monkeypatch, capsys):
        monkeypatch.setattr(t, "TODO_FILE", tmp_file)
        result = t.main(["list"])
        assert result == 0
        captured = capsys.readouterr()
        assert "まだありません" in captured.out

    def test_list_command_shows_priority(self, tmp_file, monkeypatch, capsys):
        monkeypatch.setattr(t, "TODO_FILE", tmp_file)
        t.main(["add", "高優先", "--priority", "high"])
        capsys.readouterr()
        t.main(["list"])
        captured = capsys.readouterr()
        assert "!高" in captured.out

    def test_list_command_with_items(self, tmp_file, monkeypatch, capsys):
        monkeypatch.setattr(t, "TODO_FILE", tmp_file)
        t.main(["add", "リストテスト"])
        capsys.readouterr()
        result = t.main(["list"])
        assert result == 0
        captured = capsys.readouterr()
        assert "リストテスト" in captured.out

    def test_done_command(self, tmp_file, monkeypatch, capsys):
        monkeypatch.setattr(t, "TODO_FILE", tmp_file)
        t.main(["add", "完了テスト"])
        capsys.readouterr()
        result = t.main(["done", "1"])
        assert result == 0
        captured = capsys.readouterr()
        assert "完了" in captured.out

    def test_delete_command(self, tmp_file, monkeypatch, capsys):
        monkeypatch.setattr(t, "TODO_FILE", tmp_file)
        t.main(["add", "削除テスト"])
        capsys.readouterr()
        result = t.main(["delete", "1"])
        assert result == 0
        captured = capsys.readouterr()
        assert "削除" in captured.out

    def test_no_command_returns_1(self, capsys):
        result = t.main([])
        assert result == 1

    def test_done_nonexistent_id_returns_1(self, tmp_file, monkeypatch, capsys):
        monkeypatch.setattr(t, "TODO_FILE", tmp_file)
        result = t.main(["done", "999"])
        assert result == 1
        captured = capsys.readouterr()
        assert "エラー" in captured.err

    def test_delete_nonexistent_id_returns_1(self, tmp_file, monkeypatch, capsys):
        monkeypatch.setattr(t, "TODO_FILE", tmp_file)
        result = t.main(["delete", "999"])
        assert result == 1
        captured = capsys.readouterr()
        assert "エラー" in captured.err

    def test_add_empty_title_returns_1(self, tmp_file, monkeypatch, capsys):
        monkeypatch.setattr(t, "TODO_FILE", tmp_file)
        result = t.main(["add", ""])
        assert result == 1
        captured = capsys.readouterr()
        assert "エラー" in captured.err


# ---------------------------------------------------------------------------
# 統合テスト
# ---------------------------------------------------------------------------

class TestIntegration:
    def test_full_workflow(self, tmp_file, monkeypatch, capsys):
        """add → list → done → list → delete のフルフロー検証。"""
        monkeypatch.setattr(t, "TODO_FILE", tmp_file)

        # add 2件
        assert t.main(["add", "タスク1"]) == 0
        assert t.main(["add", "タスク2"]) == 0

        # list → 2件表示
        capsys.readouterr()
        assert t.main(["list"]) == 0
        out = capsys.readouterr().out
        assert "タスク1" in out
        assert "タスク2" in out

        # done タスク1
        assert t.main(["done", "1"]) == 0
        todos = t.load_todos(tmp_file)
        assert todos[0]["done"] is True
        assert todos[1]["done"] is False

        # list → 完了状態を含む表示
        capsys.readouterr()
        assert t.main(["list"]) == 0
        out = capsys.readouterr().out
        assert "1/2 完了" in out

        # delete タスク2
        assert t.main(["delete", "2"]) == 0
        todos = t.load_todos(tmp_file)
        assert len(todos) == 1
        assert todos[0]["id"] == 1

    def test_id_does_not_reuse_after_delete(self, tmp_file):
        """削除後に追加しても旧IDを再利用しない。"""
        t.add_todo("A", tmp_file)
        t.add_todo("B", tmp_file)
        t.delete_todo(1, tmp_file)
        item = t.add_todo("C", tmp_file)
        assert item["id"] == 3  # 1は再利用しない

    def test_priority_workflow(self, tmp_file, monkeypatch, capsys):
        """優先度を指定した add → list（優先度順表示）のフロー検証。"""
        monkeypatch.setattr(t, "TODO_FILE", tmp_file)

        assert t.main(["add", "低優先タスク", "--priority", "low"]) == 0
        assert t.main(["add", "高優先タスク", "--priority", "high"]) == 0
        assert t.main(["add", "中優先タスク", "--priority", "medium"]) == 0

        capsys.readouterr()
        assert t.main(["list"]) == 0
        out = capsys.readouterr().out

        # 高優先が低優先より先に表示されること
        assert out.index("高優先タスク") < out.index("低優先タスク")
        assert out.index("高優先タスク") < out.index("中優先タスク")
        assert out.index("中優先タスク") < out.index("低優先タスク")
