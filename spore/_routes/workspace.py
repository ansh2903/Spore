from flask import render_template, request, session, jsonify, Response, stream_with_context
from spore._utils import load_settings
from spore._logger import logging
from spore._engine.model_manager import get_engine
from spore._routes.utils import generate_blueprint
from spore._compute.context import (
    connector_from_session,
    find_connection,
    get_relations,
    host_data_dir,
    host_path_for_stream,
    kernel_path_for_stream,
    new_relation_id,
    save_relation,
)
import json
import os

workspace_blueprint = generate_blueprint('workspace')


@workspace_blueprint.route('/chat', methods=['GET', 'POST'])
def chat():
    try:
        cfg = load_settings() or {}
        provider, model = cfg.get("provider"), cfg.get("model")
        connections = session.get('connections', [])
    except Exception as e:
        logging.error(f"Error fetching connections: {str(e)}")
        connections = []
        provider, model = None, None

    return render_template(
        "pages/chat.html",
        connections=connections,
        provider=provider,
        model=model,
    )


@workspace_blueprint.route('/chat/ask', methods=['POST'])
def ask():
    try:
        user_input = request.form.get('message')
        db_id = request.form.get('selected_db_id')
        context_sql = request.form.get('context_sql', '')

        selected_conn = find_connection(session, db_id)
        if not selected_conn:
            return jsonify({"error": "Connection not found"}), 404

        db_type = selected_conn.get("source_type") or selected_conn.get("db_type", "postgresql")
        metadata = selected_conn.get("metadata", {})

        if context_sql:
            user_input = (
                f"Current SQL in the notebook cell:\n```sql\n{context_sql}\n```\n\n"
                f"User request: {user_input}"
            )

        model = get_engine()

        def stream():
            try:
                for token in model.generate(
                    user_input=user_input,
                    db_type=db_type,
                    metadata=metadata,
                ):
                    yield f"data: {json.dumps(token)}\n\n"
            except Exception as e:
                logging.error(f"Error during inference generation: {e}")
                yield f"data: {json.dumps({'type': 'error', 'content': 'An error occurred during response generation.'})}\n\n"

        return Response(stream(), mimetype='text/event-stream')

    except Exception as e:
        logging.error(f"Error in /chat/ask: {e}")
        return jsonify({"error": "An error occurred while processing your request."}), 500


@workspace_blueprint.route('/query-preview', methods=['POST'])
def preview():
    try:
        query = request.form.get("query")
        selected_id = request.form.get("id")
        limit = int(request.form.get("limit", 500))

        raw_data = find_connection(session, selected_id)
        if not raw_data:
            return jsonify({"status": "error", "message": "Connection not found"}), 404

        connector = connector_from_session(raw_data)

        def generate_stream():
            try:
                for chunk in connector.preview(query=query, limit=limit):
                    yield f"data: {json.dumps(chunk, default=str)}\n\n"
            except Exception as e:
                logging.error(f"Stream error: {e}")
                yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"

        return Response(stream_with_context(generate_stream()), mimetype='text/event-stream')

    except Exception as e:
        logging.error(f"Query execution error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


def _run_materialize(query: str, conn_id: str, stream_name: str, relation_id: str | None = None):
    raw_data = find_connection(session, conn_id)
    if not raw_data:
        return None, jsonify({"status": "error", "message": "Connection not found"}), 404

    os.makedirs(host_data_dir(), exist_ok=True)
    connector = connector_from_session(raw_data)
    status, result = connector.ingest(
        stream_name=stream_name,
        query=query,
        destination_path=host_data_dir(),
    )

    if status != "success":
        return None, jsonify({"status": "error", "message": result}), 500

    rel_id = relation_id or new_relation_id()
    host_path = host_path_for_stream(stream_name)
    kernel_path = kernel_path_for_stream(stream_name)

    relation = {
        "relation_id": rel_id,
        "connection_id": str(conn_id),
        "stream_name": stream_name,
        "sql": query,
        "materialized": {
            "path": host_path,
            "kernel_path": kernel_path,
            "format": "parquet",
        },
    }
    save_relation(session, relation)

    return {
        "status": "success",
        "relation_id": rel_id,
        "stream_name": stream_name,
        "path": host_path,
        "kernel_path": kernel_path,
    }, None, None


@workspace_blueprint.route('/materialize', methods=['POST'])
def materialize():
    try:
        query = request.form.get('query')
        conn_id = request.form.get('id')
        stream_name = request.form.get('stream_name') or f"stream_{new_relation_id()[-8:]}"
        relation_id = request.form.get('relation_id')

        payload, err_resp, code = _run_materialize(query, conn_id, stream_name, relation_id)
        if err_resp:
            return err_resp, code
        return jsonify(payload)

    except Exception as e:
        logging.error(f"materialize error: {e}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 500


@workspace_blueprint.route('/view-data-extraction', methods=['POST'])
def extraction():
    """Legacy alias for materialize."""
    try:
        query = request.form.get('query')
        conn_id = request.form.get('id')
        stream_name = request.form.get('stream_name') or f"stream_{new_relation_id()[-8:]}"

        payload, err_resp, code = _run_materialize(query, conn_id, stream_name)
        if err_resp:
            return err_resp, code
        return jsonify(payload)

    except Exception as e:
        logging.error(f"data-stream error: {e}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 500


@workspace_blueprint.route('/relations', methods=['GET'])
def list_relations():
    relations = get_relations(session)
    return jsonify({"relations": list(relations.values())})


@workspace_blueprint.route('/relations/<relation_id>', methods=['GET'])
def get_relation(relation_id):
    relations = get_relations(session)
    rel = relations.get(relation_id)
    if not rel:
        return jsonify({"status": "error", "message": "Relation not found"}), 404
    return jsonify(rel)
