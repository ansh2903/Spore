from flask import render_template, request, session, redirect, url_for, flash
from uuid_extensions import uuid7

from spore._routes.utils import generate_blueprint
from spore._connectors import SourceConnector
from spore._config.settings import VENDOR_CONFIG, COMMON_LAYERS

from spore._utils import encrypt_creds, is_running_in_docker
from spore._logger import logging
from spore._exception import CustomException

connections_blueprint = generate_blueprint('connections')

# Connections management (add, edit, delete)
@connections_blueprint.route('/connections', methods=['GET'])
def connections():
    """Source management and list page"""
    try:
        connections = session.get("connections", [])
        no_of_connections = len(connections) or 0

        return render_template(
            'pages/connections.html', 
            connections=connections, 
            no_of_connections=no_of_connections,
            config=VENDOR_CONFIG
        )
    
    except Exception as e:
        logging.error(f"connections list failed: {e}")
        return render_template('pages/error.html', error_message=str(e))

@connections_blueprint.route('/connections/new', methods=['GET', 'POST'])
def new_connector():
    return render_template("pages/connections_new.html", source=VENDOR_CONFIG)

@connections_blueprint.route('/connections/new/<vendor>', methods=['GET'])
def add_new_connection(vendor):
    try:
        source_config = None
        for category_name, items in VENDOR_CONFIG:
            if vendor in items:
                source_config = items[vendor]
                break
                
        # 2. Handle not found
        if not source_config:
            return f"<div class='text-red-500'>Unsupported database type: {vendor}</div>", 404

        # 3. Pass ONLY the specific source_config and the common layers
        return render_template(
            'partials/form.html', 
            kind=category_name,
            source_type=vendor,
            config=source_config, 
            common_layers=COMMON_LAYERS
        )    
    except Exception as e:
        logging.error(f"Template for {vendor} not found: {str(e)}")
        return render_template('pages/error.html', error_message=f"Template for {vendor} not found: {str(e)}")
    
@connections_blueprint.route('/test-connection', methods=['POST'])
def test_connection():
    data = request.form.to_dict()
    kind        = data.pop("kind", "").lower()
    source_type = data.pop("source_type", "")
    name        = data.pop("name", source_type)
    desc        = data.pop("desc", "")
    use_ssh     = data.pop("use_ssh", "false").lower() == "true"
    use_ssl     = data.pop("use_ssl", "false").lower() == "true"

    data = {k: v for k, v in data.items() if v not in ("", None)}

    # Handle Docker localhost edge case before encrypting
    if is_running_in_docker() and data.get("host") in ("Localhost", "localhost", "127.0.0.1"):
        data["host"] = "host.docker.internal"

    temp_paths = []
    try:
        # Handle uploaded files — save to temp, inject path
        if request.files:
            import tempfile, os
            for file_key in request.files:
                f = request.files[file_key]
                if f and f.filename:
                    ext = os.path.splitext(f.filename)[1] or ".pem"
                    fd, tmp = tempfile.mkstemp(suffix=ext)
                    with os.fdopen(fd, "wb") as out:
                        f.save(out)
                    data[file_key] = tmp
                    temp_paths.append(tmp)

        # Test before saving
        connector = SourceConnector(
            kind        = kind,
            source_type = source_type,
            creds       = encrypt_creds(data), 
            use_ssh     = use_ssh,
            use_ssl     = use_ssl
        )
        
        ok, msg = connector.test()

        return {"status": ok, "msg": msg}
    except Exception as e:
        return {"status": False, "msg": str(e)}
    
    finally:
        for path in temp_paths:
            try:
                if os.path.exists(path):
                    os.remove(path)
            except Exception as cleanup_err:
                print(f"Failed to cleanup {path}: {cleanup_err}")

# Delete database
@connections_blueprint.route('/delete-connector/<conn_id>', methods=['GET'])
def delete_connector(conn_id):
    try:
        connections = session.get("connections", [])
        connections = [conn for conn in connections if conn.get("id") != conn_id]
        for index, conn in enumerate(connections, start=1):
            conn["id"] = index

        session["connections"] = connections
        flash("Database deleted successfully.", "success")
        return redirect(url_for('connections.connections'))
    except Exception as e:
        flash(f"Error deleting database: {str(e)}", "error")
        return redirect(url_for('connections.connections'))


# Later make sure the cert files are kept in an encrypted volume, For lazy pool 
# and also keep the tunnels open for a set amount of time to keep the connections warmed up. 
@connections_blueprint.route('/registry', methods=['POST'])
def registry():
    data = request.form.to_dict()
    kind        = data.pop("kind", "").lower()
    source_type = data.pop("source_type", "")
    name        = data.pop("name", source_type)
    desc        = data.pop("desc", "")
    use_ssh     = data.pop("use_ssh", "false").lower() == "true"
    use_ssl     = data.pop("use_ssl", "false").lower() == "true"

    data = {k: v for k, v in data.items() if v not in ("", None)}

    # Handle Docker localhost edge case before encrypting
    if is_running_in_docker() and data.get("host") in ("Localhost", "localhost", "127.0.0.1"):
        data["host"] = "host.docker.internal"

    temp_paths = []
    try:
        # Handle uploaded files — save to temp, inject path
        if request.files:
            import tempfile, os
            for file_key in request.files:
                f = request.files[file_key]
                if f and f.filename:
                    ext = os.path.splitext(f.filename)[1] or ".pem"
                    fd, tmp = tempfile.mkstemp(suffix=ext)
                    with os.fdopen(fd, "wb") as out:
                        f.save(out)
                    data[file_key] = tmp
                    temp_paths.append(tmp)

        # Test before saving
        connector = SourceConnector(
            kind        = kind,
            source_type = source_type,
            creds       = encrypt_creds(data), 
            use_ssh     = use_ssh,
            use_ssl     = use_ssl
        )
        
        ok, msg = connector.test()
        if not ok:
            flash(f"Connection failed: {msg}", "error")
            return redirect(url_for("connections.new_connector"))

        ok_meta, metadata = connector.fetch_metadata()
        if not ok_meta:
            metadata = {}

        conns = session.get("connections", [])
        conns.append({
            "id":          str(uuid7()),
            "name":        name,
            "kind":        kind,
            "source_type": source_type,
            "desc":        desc,
            "credentials": encrypt_creds(data),
            "metadata":    metadata,
            "use_ssh":     use_ssh,
            "use_ssl":     use_ssl,
            "created_at":  __import__("datetime").datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        })
        session["connections"] = conns
        print(session["connections"])
        session.modified = True

        flash("Station linked.", "success")
        return redirect(url_for("connections.connections"))

    except Exception as e:
        logging.error(f"registry failed: {e}")
        flash(f"System error: {e}", "error")
        return redirect(url_for("connections.new_connector"))
    finally:
        if temp_paths:
            for p in temp_paths:
                try: os.remove(p)
                except: pass
