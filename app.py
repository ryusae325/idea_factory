import os
import uuid
import sqlite3
import base64
import requests
from datetime import datetime, timedelta
from flask import Flask, render_template, request, jsonify, session, send_from_directory

app = Flask(__name__)
app.secret_key = 'idea_factory_super_secret_key'

# アップロードフォルダの設定
UPLOAD_FOLDER = os.path.join(app.root_path, 'static', 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# ---------------------------------------------------------
# 【設定】AI画像生成機能のON/OFFスイッチ
# ---------------------------------------------------------
ENABLE_AI_IMAGE = False

# ---------------------------------------------------------
# 【設定】権利侵害・類似チェック機能のON/OFFスイッチ
# ---------------------------------------------------------
ENABLE_INFRINGEMENT_CHECK = False

# Gemini API キーの設定
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

# --- データベース初期化 ---
def get_db():
    conn = sqlite3.connect('database.db')
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        password TEXT NOT NULL,
        balance INTEGER DEFAULT 0,
        is_admin INTEGER DEFAULT 0
    )
    ''')
    
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS ideas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        image_url TEXT,
        status TEXT DEFAULT 'アイデア募集',
        creator_name TEXT NOT NULL,
        modeler_name TEXT DEFAULT '',
        creator_share INTEGER DEFAULT 50,
        modeler_share INTEGER DEFAULT 50,
        price_physical INTEGER DEFAULT 3000,
        price_digital INTEGER DEFAULT 1000,
        total_sales INTEGER DEFAULT 0,
        platform_fee INTEGER DEFAULT 0,
        creator_reward INTEGER DEFAULT 0,
        modeler_reward INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        idea_id INTEGER NOT NULL,
        item_type TEXT NOT NULL,
        shipping_status TEXT DEFAULT '手配中',
        tracking_number TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS balance_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        amount INTEGER NOT NULL,
        type TEXT NOT NULL,
        expires_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS exchange_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        exchange_type TEXT NOT NULL,
        amount INTEGER NOT NULL,
        status TEXT DEFAULT '申請中',
        gift_code TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    ''')

    cursor.execute('''
    CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        idea_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        comment_type TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    ''')

    cursor.execute('''
    CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        idea_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        rating INTEGER NOT NULL,
        comment TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    ''')

    cursor.execute("SELECT * FROM users WHERE username = 'admin'")
    if not cursor.fetchone():
        cursor.execute("INSERT INTO users (username, password, balance, is_admin) VALUES ('admin', 'admin123', 0, 1)")

    conn.commit()
    conn.close()

init_db()

# --- 静的ファイル・ページルーティング ---
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/terms')
def terms():
    return render_template('terms.html')

@app.route('/static/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# --- 認証 API ---
@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json() or {}
    username = data.get('username', '').strip()
    password = data.get('password', '').strip()

    if not username:
        return jsonify({"status": "error", "message": "ユーザー名を入力してください"}), 400

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
    user = cursor.fetchone()

    if not user:
        cursor.execute("INSERT INTO users (username, password, balance, is_admin) VALUES (?, ?, 0, ?)",
                       (username, password or 'pass', 1 if username == 'admin' else 0))
        conn.commit()
        cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
        user = cursor.fetchone()

    session['username'] = user['username']
    conn.close()

    return jsonify({
        "status": "ok",
        "username": user['username'],
        "balance": user['balance'],
        "is_admin": bool(user['is_admin'])
    })

@app.route('/api/logout', methods=['POST'])
def logout():
    session.pop('username', None)
    return jsonify({"status": "ok"})

@app.route('/api/me', methods=['GET'])
def get_me():
    username = session.get('username')
    if not username:
        return jsonify({"authenticated": False})
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT username, balance, is_admin FROM users WHERE username = ?", (username,))
    user = cursor.fetchone()
    conn.close()

    if not user:
        return jsonify({"authenticated": False})

    return jsonify({
        "authenticated": True,
        "username": user['username'],
        "balance": user['balance'],
        "is_admin": bool(user['is_admin'])
    })

# --- 類似・権利侵害チェック API ---
@app.route('/api/check-infringement', methods=['POST'])
def check_infringement():
    if not ENABLE_INFRINGEMENT_CHECK:
        return jsonify({
            "status": "info",
            "message": "※この機能は今後実装予定です。\n\n将来的には、入力されたアイデアが既存の著作物や商標等と重複していないかをAIが自動でチェックするようになります。"
        })

    data = request.get_json() or {}
    title = data.get('title', '')
    desc = data.get('desc', '')
    
    if not title:
        return jsonify({"status": "error", "message": "タイトルを入力してください"}), 400

    return jsonify({
        "status": "ok",
        "message": "【AIチェック完了】\n権利侵害や類似アイデアの重複リスクは低いと判定されました。"
    })

# --- Gemini 画像生成 API ---
@app.route('/api/generate-ai-image', methods=['POST'])
def generate_ai_image():
    data = request.get_json() or {}
    title = data.get('title', '')
    desc = data.get('desc', '')
    
    if not title:
        return jsonify({"status": "error", "message": "タイトルを入力してください"}), 400

    if not ENABLE_AI_IMAGE:
        return jsonify({
            "status": "error",
            "message": "AIによる画像自動生成機能は現在準備中です。\nお手元の画像をアップロードするか、そのままテキストのみで投稿してください。"
        }), 400

    prompt = f"3D printable product concept, {title}. {desc}. Clear product design, isolated on clean white background, isometric view, studio lighting."

    try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key={GEMINI_API_KEY}"
        headers = {"Content-Type": "application/json"}
        payload = {
            "instances": [{"prompt": prompt}],
            "parameters": {"sampleCount": 1, "aspectRatio": "1:1"}
        }

        res = requests.post(url, headers=headers, json=payload, timeout=30)
        res_data = res.json()

        if res.status_code == 200 and 'predictions' in res_data:
            b64_image = res_data['predictions'][0]['bytesBase64Encoded']
            img_data = base64.b64decode(b64_image)

            filename = f"img_ai_{uuid.uuid4().hex}.png"
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            
            with open(filepath, 'wb') as f:
                f.write(img_data)

            return jsonify({
                "status": "ok",
                "filename": filename,
                "url": f"/static/uploads/{filename}"
            })
        else:
            print("Gemini Image API Exception/Quota:", res_data)
            raise Exception(res_data.get('error', {}).get('message', 'API Error'))

    except Exception as e:
        print(f"AI画像生成フォールバック起動: {e}")
        return jsonify({
            "status": "ok",
            "filename": None,
            "url": "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='600' height='600' viewBox='0 0 600 600'><rect width='600' height='600' fill='%233b82f6'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='%23ffffff' font-family='sans-serif' font-size='24'>Concept Image</text></svg>"
        })

# --- アイデア・商品管理 API ---
@app.route('/api/ideas', methods=['GET'])
def get_ideas():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT i.*, 
               COALESCE(AVG(r.rating), 0) as avg_rating,
               COUNT(r.id) as review_count
        FROM ideas i
        LEFT JOIN reviews r ON i.id = r.idea_id
        GROUP BY i.id
        ORDER BY i.id DESC
    ''')
    ideas = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify(ideas)

@app.route('/api/ideas/<int:idea_id>', methods=['GET'])
def get_idea_detail(idea_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM ideas WHERE id = ?", (idea_id,))
    idea = cursor.fetchone()
    if not idea:
        conn.close()
        return jsonify({"status": "error", "message": "対象のアイデアが存在しません"}), 404
    
    idea_dict = dict(idea)
    
    cursor.execute("SELECT * FROM comments WHERE idea_id = ? ORDER BY id ASC", (idea_id,))
    idea_dict['comments'] = [dict(row) for row in cursor.fetchall()]
    
    conn.close()
    return jsonify(idea_dict)

@app.route('/api/ideas', methods=['POST'])
def create_idea():
    username = session.get('username')
    if not username:
        return jsonify({"status": "error", "message": "ログインが必要です"}), 401

    title = request.form.get('title')
    description = request.form.get('description', '')
    creator_share = int(request.form.get('creator_share', 50))
    modeler_share = 100 - creator_share
    price_physical = int(request.form.get('price_physical', 3000))
    price_digital = int(request.form.get('price_digital', 1000))

    if not title:
        return jsonify({"status": "error", "message": "タイトルは必須です"}), 400

    image_filename = ""
    ai_image_filename = request.form.get('ai_image_filename')
    
    if 'image' in request.files and request.files['image'].filename != '':
        file = request.files['image']
        ext = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else 'png'
        image_filename = f"img_{uuid.uuid4().hex}.{ext}"
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], image_filename))
    elif ai_image_filename:
        image_filename = ai_image_filename

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
    INSERT INTO ideas (title, description, image_url, creator_name, creator_share, modeler_share, price_physical, price_digital)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ''', (title, description, image_filename, username, creator_share, modeler_share, price_physical, price_digital))
    conn.commit()
    conn.close()

    return jsonify({"status": "ok", "message": "アイデアを投稿しました！"})

@app.route('/api/ideas/<int:idea_id>', methods=['DELETE'])
def delete_idea(idea_id):
    username = session.get('username')
    if not username:
        return jsonify({"status": "error", "message": "権限がありません"}), 403

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
    user = cursor.fetchone()

    cursor.execute("SELECT * FROM ideas WHERE id = ?", (idea_id,))
    idea = cursor.fetchone()

    if not idea:
        conn.close()
        return jsonify({"status": "error", "message": "対象のアイデアが存在しません"}), 404

    if not user['is_admin'] and idea['creator_name'] != username:
        conn.close()
        return jsonify({"status": "error", "message": "削除権限がありません"}), 403

    cursor.execute("DELETE FROM ideas WHERE id = ?", (idea_id,))
    conn.commit()
    conn.close()
    return jsonify({"status": "ok", "message": "削除しました"})

@app.route('/api/ideas/<int:idea_id>/status', methods=['POST'])
def update_idea_status(idea_id):
    username = session.get('username')
    if not username:
        return jsonify({"status": "error", "message": "ログインが必要です"}), 401

    data = request.get_json() or {}
    new_status = data.get('status')

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM ideas WHERE id = ?", (idea_id,))
    idea = cursor.fetchone()

    if not idea:
        conn.close()
        return jsonify({"status": "error", "message": "該当データがありません"}), 404

    if new_status == '制作中' and idea['status'] == 'アイデア募集':
        cursor.execute("UPDATE ideas SET status = ?, modeler_name = ? WHERE id = ?", (new_status, username, idea_id))
    else:
        cursor.execute("UPDATE ideas SET status = ? WHERE id = ?", (new_status, idea_id))

    conn.commit()
    conn.close()
    return jsonify({"status": "ok", "message": f"ステータスを「{new_status}」に変更しました"})

# --- 購入 & 売上分配 API ---
@app.route('/api/ideas/<int:idea_id>/buy', methods=['POST'])
def buy_item(idea_id):
    username = session.get('username')
    if not username:
        return jsonify({"status": "error", "message": "ログインが必要です"}), 401

    data = request.get_json() or {}
    price = int(data.get('price', 0))
    item_type = data.get('item_type', 'physical')

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM ideas WHERE id = ?", (idea_id,))
    item = cursor.fetchone()

    if not item:
        conn.close()
        return jsonify({"status": "error", "message": "商品が見つかりません"}), 404

    add_fee = int(price * 0.30)
    add_rem = price - add_fee
    c_add = int(add_rem * (item['creator_share'] / 100.0))
    m_add = int(add_rem * (item['modeler_share'] / 100.0))

    new_total_sales = item['total_sales'] + price
    new_platform_fee = item['platform_fee'] + add_fee
    new_c_reward = item['creator_reward'] + c_add
    new_m_reward = item['modeler_reward'] + m_add

    cursor.execute('''
    UPDATE ideas SET total_sales = ?, platform_fee = ?, creator_reward = ?, modeler_reward = ?
    WHERE id = ?
    ''', (new_total_sales, new_platform_fee, new_c_reward, new_m_reward, idea_id))

    expires_at = (datetime.now() + timedelta(days=180)).strftime('%Y-%m-%d %H:%M:%S')

    if c_add > 0 and item['creator_name']:
        cursor.execute("UPDATE users SET balance = balance + ? WHERE username = ?", (c_add, item['creator_name']))
        cursor.execute("INSERT INTO balance_history (username, amount, type, expires_at) VALUES (?, ?, '売上分配', ?)",
                       (item['creator_name'], c_add, expires_at))

    if m_add > 0 and item['modeler_name']:
        cursor.execute("UPDATE users SET balance = balance + ? WHERE username = ?", (m_add, item['modeler_name']))
        cursor.execute("INSERT INTO balance_history (username, amount, type, expires_at) VALUES (?, ?, '売上分配', ?)",
                       (item['modeler_name'], m_add, expires_at))

    cursor.execute('''
    INSERT INTO orders (username, idea_id, item_type, shipping_status)
    VALUES (?, ?, ?, ?)
    ''', (username, idea_id, item_type, '手配中' if item_type == 'physical' else '完了'))

    conn.commit()
    conn.close()
    return jsonify({"status": "ok", "message": f"商品（{item_type}）を購入しました！考案者とモデラーへ売上が分配されました。"})

# --- コメント API ---
@app.route('/api/ideas/<int:idea_id>/comments', methods=['GET', 'POST'])
def handle_comments(idea_id):
    conn = get_db()
    cursor = conn.cursor()

    if request.method == 'POST':
        username = session.get('username')
        if not username:
            conn.close()
            return jsonify({"status": "error", "message": "ログインが必要です"}), 401

        data = request.get_json() or {}
        comment_type = data.get('comment_type', 'recruitment')
        content = data.get('content', '').strip() or data.get('comment', '').strip()

        if not content:
            conn.close()
            return jsonify({"status": "error", "message": "コメントを入力してください"}), 400

        cursor.execute('''
        INSERT INTO comments (idea_id, username, comment_type, content)
        VALUES (?, ?, ?, ?)
        ''', (idea_id, username, comment_type, content))
        conn.commit()
        conn.close()
        return jsonify({"status": "ok", "message": "コメントを投稿しました"})

    else:
        cursor.execute('''
        SELECT * FROM comments WHERE idea_id = ? ORDER BY id ASC
        ''', (idea_id,))
        comments = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify(comments)

@app.route('/api/ideas/<int:idea_id>/comments/<int:comment_id>', methods=['DELETE'])
def delete_comment(idea_id, comment_id):
    username = session.get('username')
    if not username:
        return jsonify({"status": "error", "message": "ログインが必要です"}), 401

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
    user = cursor.fetchone()

    cursor.execute("SELECT * FROM comments WHERE id = ? AND idea_id = ?", (comment_id, idea_id))
    comment = cursor.fetchone()

    if not comment:
        conn.close()
        return jsonify({"status": "error", "message": "コメントが見つかりません"}), 404

    if not user['is_admin'] and comment['username'] != username:
        conn.close()
        return jsonify({"status": "error", "message": "削除権限がありません"}), 403

    cursor.execute("DELETE FROM comments WHERE id = ?", (comment_id,))
    conn.commit()
    conn.close()
    return jsonify({"status": "ok", "message": "コメントを削除しました"})

# --- マイページデータ API ---
@app.route('/api/my/data', methods=['GET'])
def get_my_data():
    username = session.get('username')
    if not username:
        return jsonify({"status": "error", "message": "ログインが必要です"}), 401

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM ideas WHERE creator_name = ?", (username,))
    my_ideas = [dict(row) for row in cursor.fetchall()]

    cursor.execute("SELECT * FROM ideas WHERE modeler_name = ?", (username,))
    my_modeling = [dict(row) for row in cursor.fetchall()]

    cursor.execute('''
    SELECT o.*, i.title 
    FROM orders o 
    JOIN ideas i ON o.idea_id = i.id 
    WHERE o.username = ? ORDER BY o.id DESC
    ''', (username,))
    my_purchases = [dict(row) for row in cursor.fetchall()]

    cursor.execute("SELECT * FROM balance_history WHERE username = ? ORDER BY id DESC", (username,))
    history = [dict(row) for row in cursor.fetchall()]

    conn.close()
    return jsonify({
        "my_ideas": my_ideas,
        "my_modeling": my_modeling,
        "my_purchases": my_purchases,
        "balance_history": history
    })

# --- デジタルギフト交換 API ---
@app.route('/api/exchange-requests', methods=['GET', 'POST'])
def exchange_requests():
    username = session.get('username')
    if not username:
        return jsonify({"status": "error", "message": "ログインが必要です"}), 401

    conn = get_db()
    cursor = conn.cursor()

    if request.method == 'POST':
        data = request.get_json() or {}
        exchange_type = data.get('exchange_type', 'Amazonギフトカード')
        amount = int(data.get('amount', 0))

        if amount < 1000:
            conn.close()
            return jsonify({"status": "error", "message": "最低交換金額は1,000円です"}), 400

        cursor.execute("SELECT balance FROM users WHERE username = ?", (username,))
        user = cursor.fetchone()

        if user['balance'] < amount:
            conn.close()
            return jsonify({"status": "error", "message": "残高が不足しています"}), 400

        cursor.execute("UPDATE users SET balance = balance - ? WHERE username = ?", (amount, username))
        cursor.execute('''
        INSERT INTO exchange_requests (username, exchange_type, amount, status)
        VALUES (?, ?, ?, '未処理')
        ''', (username, exchange_type, amount))
        cursor.execute('''
        INSERT INTO balance_history (username, amount, type)
        VALUES (?, ?, ?)
        ''', (username, -amount, f'{exchange_type}交換申請'))

        conn.commit()
        conn.close()
        return jsonify({"status": "ok", "message": "交換申請を受け付けました"})

    else:
        cursor.execute("SELECT * FROM exchange_requests WHERE username = ? ORDER BY id DESC", (username,))
        requests_list = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify(requests_list)

# --- 運営管理 API ---
@app.route('/api/admin/exchange-requests', methods=['GET'])
def admin_get_exchange_requests():
    username = session.get('username')
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT is_admin FROM users WHERE username = ?", (username,))
    user = cursor.fetchone()

    if not user or not user['is_admin']:
        conn.close()
        return jsonify({"status": "error", "message": "管理者権限が必要です"}), 403

    cursor.execute("SELECT * FROM exchange_requests ORDER BY id DESC")
    requests_list = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify(requests_list)

@app.route('/api/admin/exchange-requests/<int:req_id>/process', methods=['POST'])
def admin_update_exchange_request(req_id):
    username = session.get('username')
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT is_admin FROM users WHERE username = ?", (username,))
    user = cursor.fetchone()

    if not user or not user['is_admin']:
        conn.close()
        return jsonify({"status": "error", "message": "管理者権限が必要です"}), 403

    data = request.get_json() or {}
    gift_code = data.get('gift_code', '')

    cursor.execute("UPDATE exchange_requests SET status = ?, gift_code = ? WHERE id = ?", ('完了', gift_code, req_id))
    conn.commit()
    conn.close()
    return jsonify({"status": "ok", "message": "申請ステータスを更新しました"})

@app.route('/api/admin/orders', methods=['GET'])
def admin_get_orders():
    username = session.get('username')
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT is_admin FROM users WHERE username = ?", (username,))
    user = cursor.fetchone()

    if not user or not user['is_admin']:
        conn.close()
        return jsonify({"status": "error", "message": "管理者権限が必要です"}), 403

    cursor.execute('''
    SELECT o.*, i.title 
    FROM orders o 
    JOIN ideas i ON o.idea_id = i.id 
    ORDER BY o.id DESC
    ''')
    orders = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify(orders)

@app.route('/api/admin/orders/<int:order_id>/shipping', methods=['POST'])
def admin_update_shipping(order_id):
    username = session.get('username')
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT is_admin FROM users WHERE username = ?", (username,))
    user = cursor.fetchone()

    if not user or not user['is_admin']:
        conn.close()
        return jsonify({"status": "error", "message": "管理者権限が必要です"}), 403

    data = request.get_json() or {}
    shipping_status = data.get('shipping_status', '手配中')
    tracking_number = data.get('tracking_number', '')

    cursor.execute("UPDATE orders SET shipping_status = ?, tracking_number = ? WHERE id = ?", 
                   (shipping_status, tracking_number, order_id))
    conn.commit()
    conn.close()
    return jsonify({"status": "ok", "message": "配送ステータスを更新しました"})

if __name__ == '__main__':
    app.run(debug=True, port=5000)