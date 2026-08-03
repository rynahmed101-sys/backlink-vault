import os
import sys
import json
import base64
import sqlite3
import urllib.request
import urllib.parse
import urllib.error
import ssl
from bs4 import BeautifulSoup
import re
import time
import threading
import csv
import secrets
import hashlib
import socket
from datetime import datetime, timedelta
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

# Set up paths & Environment Configuration
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "vault.db")
STATIC_DIR = BASE_DIR

# Load .env file into os.environ
env_path = os.path.join(BASE_DIR, ".env")
if os.path.exists(env_path):
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ[k.strip()] = v.strip()

PORT = 8080
SECRET_KEY = os.environ.get("SECRET_KEY", "vault_default_secret_key_2026")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "ryn.ahmed101@gmail.com").strip().lower()
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Ryan@1206")
DEFAULT_BOT_DELAY = float(os.environ.get("BOT_DELAY", 1.0))

# Ubersuggest MCP Integration
UBERSUGGEST_MCP_URL    = "https://ubersuggest-mcp.neilpatelapi.com/mcp"
UBERSUGGEST_AUTH_URL   = "https://ubersuggest-mcp.neilpatelapi.com/authorize"
UBERSUGGEST_TOKEN_URL  = "https://ubersuggest-mcp.neilpatelapi.com/token"
UBERSUGGEST_CLIENT_ID  = "ubersuggest-mcp"
UBERSUGGEST_REDIRECT   = os.environ.get("BASE_URL", "https://backlink-vault.up.railway.app") + "/oauth/ubersuggest/callback"
UBERSUGGEST_SCOPE      = "domain keywords backlinks"

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
]

def normalize_to_main_domain(url):
    if not url or not isinstance(url, str):
        return ""
    url = url.strip()
    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url

    try:
        parsed = urllib.parse.urlparse(url)
        netloc = parsed.netloc.lower()
        scheme = parsed.scheme.lower() or "https"
        
        path = parsed.path.rstrip("/")
        path_parts = [p for p in path.split("/") if p]

        if len(path_parts) == 1 and path_parts[0] in ["blog", "news", "articles", "press", "resources"]:
            clean_path = f"/{path_parts[0]}"
        else:
            clean_path = ""

        return f"{scheme}://{netloc}{clean_path}"
    except Exception:
        return url

def hash_password(password, salt=None):
    if not salt:
        salt = secrets.token_hex(16)
    hashed = hashlib.sha256((password + salt + SECRET_KEY).encode('utf-8')).hexdigest()
    return hashed, salt

# Database Initialization & High-Performance Indexing
def init_db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    cursor = conn.cursor()
    try:
        cursor.execute("PRAGMA journal_mode=WAL;")
    except Exception:
        pass

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT DEFAULT '',
            salt TEXT DEFAULT '',
            name TEXT DEFAULT '',
            auth_provider TEXT DEFAULT 'local',
            role TEXT DEFAULT 'user',
            avatar_url TEXT DEFAULT '',
            created_at TEXT DEFAULT ''
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created_at TEXT DEFAULT '',
            expires_at TEXT DEFAULT ''
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS backlinks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT UNIQUE NOT NULL,
            target_url TEXT DEFAULT '',
            anchor_text TEXT DEFAULT '',
            niche TEXT DEFAULT 'Uncategorized',
            da_score INTEGER DEFAULT 0,
            value_score INTEGER DEFAULT 0,
            status TEXT DEFAULT 'Pending Approval',
            http_code INTEGER DEFAULT 0,
            rel_type TEXT DEFAULT 'Unknown',
            site_title TEXT DEFAULT '',
            site_description TEXT DEFAULT '',
            response_time_ms INTEGER DEFAULT 0,
            risk_score INTEGER DEFAULT 0,
            user_id INTEGER DEFAULT 1,
            rejection_note TEXT DEFAULT '',
            acquisition_type TEXT DEFAULT 'Easy Do-Follow',
            last_checked TEXT DEFAULT '',
            created_at TEXT DEFAULT '',
            notes TEXT DEFAULT ''
        )
    ''')

    # Performance Indexing for 20k+ links
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_backlinks_status ON backlinks(status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_backlinks_user ON backlinks(user_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_backlinks_niche ON backlinks(niche)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_backlinks_url ON backlinks(url)")

    try: cursor.execute("ALTER TABLE backlinks ADD COLUMN user_id INTEGER DEFAULT 1")
    except sqlite3.OperationalError: pass

    try: cursor.execute("ALTER TABLE backlinks ADD COLUMN rejection_note TEXT DEFAULT ''")
    except sqlite3.OperationalError: pass

    try: cursor.execute("ALTER TABLE backlinks ADD COLUMN acquisition_type TEXT DEFAULT 'Easy Do-Follow'")
    except sqlite3.OperationalError: pass

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS bot_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            link_id INTEGER,
            timestamp TEXT,
            message TEXT,
            level TEXT
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS bot_settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    ''')

    # CMS Tables
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS cms_pages (
            slug TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content_html TEXT NOT NULL,
            updated_at TEXT
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS cms_settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    ''')

    # Personal Backlinks Tracker Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS personal_backlinks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            project_name TEXT DEFAULT 'General',
            backlink_url TEXT NOT NULL,
            target_url TEXT DEFAULT '',
            anchor_text TEXT DEFAULT '',
            acquisition_type TEXT DEFAULT 'Easy Do-Follow',
            status TEXT DEFAULT 'Live',
            da_score INTEGER DEFAULT 0,
            notes TEXT DEFAULT '',
            created_at TEXT DEFAULT '',
            updated_at TEXT DEFAULT ''
        )
    ''')
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_personal_user ON personal_backlinks(user_id)")

    cursor.execute("INSERT OR IGNORE INTO bot_settings (key, value) VALUES ('delay', ?)", (str(DEFAULT_BOT_DELAY),))
    cursor.execute("INSERT OR IGNORE INTO bot_settings (key, value) VALUES ('status', 'running')")
    cursor.execute("INSERT OR IGNORE INTO bot_settings (key, value) VALUES ('workers', '1')")
    cursor.execute("INSERT OR IGNORE INTO bot_settings (key, value) VALUES ('speed_mode', 'normal')")

    DEFAULT_CMS_PAGES = [
        ("about-us", "About Us", "<h2>About Backlink Vault</h2><p>Backlink Vault is an enterprise-grade intelligent link auditor and repository designed to help website owners, SEO professionals, and digital marketers discover, analyze, and manage high-authority backlinks.</p><p>Our automated inspection bot verifies response codes, rel attributes (DoFollow / NoFollow / UGC / Sponsored), Domain Authority estimations, and risk factors in real time.</p>"),
        ("company-details", "Company Details", "<h2>Company Overview</h2><p><strong>Backlink Vault Systems Inc.</strong></p><p>Empowering digital growth with authoritative backlink intelligence, domain quality metrics, and automated link indexing.</p><ul><li><strong>Email:</strong> support@backlink-vault.com</li><li><strong>Office:</strong> San Francisco, CA / Remote</li><li><strong>Version:</strong> 2.5 Enterprise Edition</li></ul>"),
        ("privacy-policy", "Privacy Policy", "<h2>Privacy Policy</h2><p>Your privacy is important to us. Backlink Vault collects minimal user information strictly necessary for account authentication and backlink project management.</p><p>We use session cookies and authentication tokens to keep your account secure. We do not sell or share user data with third parties.</p>"),
        ("terms", "Terms of Service", "<h2>Terms of Service</h2><p>By using Backlink Vault, you agree to submit valid web domain URLs for analysis and audit. Spamming, unauthorized scraping, or abusive automated submissions are strictly prohibited.</p>"),
        ("backlink-guide", "Backlink Strategy Guide", "<h2>How to Use Backlinks Effectively</h2><p>Backlinks remain one of the top search engine ranking factors. Here is how to make the most of Backlink Vault:</p><ol><li><strong>DoFollow Links:</strong> Pass link equity and Domain Authority to your target landing pages.</li><li><strong>Acquisition Categories:</strong><ul><li><strong>Easy Do-Follow:</strong> High-value open sites, profile links, and instant approval portals.</li><li><strong>Persuasion / Outreach:</strong> Require contacting site editors for guest posts or article features.</li><li><strong>Paid / Sponsored:</strong> Editorial placements or directory features requiring sponsorship.</li><li><strong>Directory / Profile:</strong> Structured web directories and company profiles.</li></ul></li><li><strong>Domain Authority (DA):</strong> Higher DA sites (40+) transmit stronger ranking signals to search engines.</li></ol>")
    ]

    for slug, title, content in DEFAULT_CMS_PAGES:
        cursor.execute("INSERT OR IGNORE INTO cms_pages (slug, title, content_html, updated_at) VALUES (?, ?, ?, ?)",
                       (slug, title, content, datetime.now().strftime("%Y-%m-%d %H:%M")))

    DEFAULT_SETTINGS = [
        ("ga_tracking_id", ""),
        ("gtm_id", ""),
        ("cookie_notice_enabled", "1"),
        ("cookie_notice_text", "We use essential cookies to maintain your session and secure login state."),
        ("ad_header_html", "<div style='padding:12px; background:rgba(34,211,238,0.08); border:1px dashed var(--accent-cyan); border-radius:8px; text-align:center; font-size:12px; color:var(--accent-cyan);'><strong>Header Ad Banner Placeholder</strong> - Configure custom ad code in Admin CMS</div>"),
        ("ad_sidebar_html", "<div style='padding:14px; background:rgba(168,85,247,0.08); border:1px dashed var(--accent-purple); border-radius:8px; text-align:center; font-size:12px; color:var(--accent-purple); margin-top:16px;'><strong>Sidebar Sponsored Slot</strong> - Managed via Admin CMS</div>"),
        ("ad_content_html", "<div style='padding:14px; background:rgba(16,185,129,0.08); border:1px dashed var(--accent-emerald); border-radius:8px; text-align:center; font-size:12px; color:var(--accent-emerald); margin:16px 0;'><strong>In-Content Ad Banner</strong> - Personal / Affiliate Ad Space</div>"),
        ("ad_footer_html", "<div style='padding:10px; background:rgba(255,255,255,0.03); border:1px dashed var(--border-color); border-radius:6px; text-align:center; font-size:11px; color:var(--text-dim); margin-top:20px;'><strong>Footer Partner Link / Ad</strong></div>"),
        ("ads_enabled", "1")
    ]

    for k, v in DEFAULT_SETTINGS:
        cursor.execute("INSERT OR IGNORE INTO cms_settings (key, value) VALUES (?, ?)", (k, v))

    cursor.execute("SELECT id FROM users WHERE LOWER(email) = ?", (ADMIN_EMAIL.lower(),))
    if not cursor.fetchone():
        admin_pass_hash, admin_salt = hash_password(ADMIN_PASSWORD)
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
        cursor.execute('''
            INSERT INTO users (email, password_hash, salt, name, auth_provider, role, created_at)
            VALUES (?, ?, ?, 'Vault Super Admin', 'local', 'admin', ?)
        ''', (ADMIN_EMAIL, admin_pass_hash, admin_salt, now_str))
    else:
        cursor.execute("UPDATE users SET role = 'admin' WHERE LOWER(email) = ?", (ADMIN_EMAIL.lower(),))

    conn.commit()
    conn.close()

def get_auth_user(headers):
    auth_header = headers.get('Authorization', '')
    token = None

def get_auth_user(headers):
    try:
        auth_header = headers.get('Authorization', '')
        token = None

        if auth_header.startswith('Bearer '):
            token = auth_header.split('Bearer ')[1].strip()

        if not token:
            cookie_header = headers.get('Cookie', '')
            for c in cookie_header.split(';'):
                if 'vault_token=' in c:
                    token = c.split('vault_token=')[1].strip()
                    break

        if not token:
            return None

        conn = sqlite3.connect(DB_PATH, timeout=10)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        cursor.execute('''
            SELECT u.id, u.email, u.name, u.role, u.avatar_url
            FROM sessions s
            JOIN users u ON s.user_id = u.id
            WHERE s.token = ?
        ''', (token,))
        user = cursor.fetchone()
        conn.close()

        return dict(user) if user else None
    except Exception as e:
        print(f"[AUTH-ERR] {e}", flush=True)
        return None

def categorize_niche(title, description, url):
    text = (f"{title} {description} {url}").lower()
    
    niches = {
        "SaaS & Tech": ["software", "saas", "app", "code", "cloud", "api", "developer", "tech", "cyber", "ai", "data", "bot", "tool", "platform"],
        "Marketing & SEO": ["marketing", "seo", "rank", "link", "agency", "traffic", "growth", "lead", "digital", "branding", "content", "social media"],
        "Finance & Crypto": ["finance", "crypto", "bitcoin", "money", "invest", "trading", "stock", "loan", "bank", "credit", "pay", "wealth", "tax"],
        "Health & Wellness": ["health", "fitness", "medical", "doctor", "wellness", "diet", "care", "clinic", "pharma", "gym", "mental", "dental"],
        "E-Commerce & Retail": ["shop", "store", "buy", "product", "cart", "discount", "deal", "price", "fashion", "apparel", "goods"],
        "News & Media": ["news", "journal", "press", "daily", "times", "report", "gazette", "media", "magazine", "blog", "post"],
        "Education & Careers": ["edu", "learn", "course", "school", "college", "university", "academy", "degree", "career", "job", "tutor"],
        "Lifestyle & Travel": ["travel", "food", "recipe", "hotel", "game", "movie", "music", "style", "home", "decor", "garden", "pet"]
    }
    
    for niche_name, keywords in niches.items():
        if any(kw in text for kw in keywords):
            return niche_name
            
    return "General Web"

def calculate_metrics(url, http_code, elapsed_ms, html_content, target_url):
    domain = urllib.parse.urlparse(url).netloc
    da = 30
    
    if domain.endswith(".edu") or domain.endswith(".gov"): da += 35
    elif domain.endswith(".org") or domain.endswith(".io"): da += 15
    elif domain.endswith(".com") or domain.endswith(".co"): da += 10
        
    if url.startswith("https://"): da += 10
        
    domain_clean = domain.replace("www.", "")
    if len(domain_clean) < 12: da += 5
        
    if elapsed_ms > 0 and elapsed_ms < 600: da += 10
    elif elapsed_ms > 2000: da -= 10
        
    if html_content:
        if "<title>" in html_content.lower(): da += 5
        if 'name="description"' in html_content.lower() or 'property="og:description"' in html_content.lower(): da += 5
        if "<h1" in html_content.lower(): da += 5
        if len(html_content) > 15000: da += 5
            
    da = max(15, min(98, da))
    
    rel_type = "Not Found"
    is_dofollow = False
    
    if html_content:
        pattern = r'<a\s+[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>'
        matches = re.findall(pattern, html_content, re.IGNORECASE | re.DOTALL)
        
        found_target = False
        for href, anchor in matches:
            if target_url and (target_url.lower() in href.lower() or href.lower() in target_url.lower()):
                found_target = True
                tag_match = re.search(r'<a\s+[^>]*href=["\']' + re.escape(href) + r'["\'][^>]*>', html_content, re.IGNORECASE)
                tag_str = tag_match.group(0) if tag_match else ""
                
                if "rel=" in tag_str.lower():
                    if "nofollow" in tag_str.lower(): rel_type = "NoFollow"
                    elif "sponsored" in tag_str.lower(): rel_type = "Sponsored"
                    elif "ugc" in tag_str.lower(): rel_type = "UGC"
                    else: rel_type = "DoFollow"; is_dofollow = True
                else:
                    rel_type = "DoFollow"
                    is_dofollow = True
                break
                
        if not found_target and target_url:
            rel_type = "Missing Link"
        elif not target_url:
            rel_type = "Domain Indexed"
            is_dofollow = True

    value_score = 0
    if http_code == 200: value_score += 25
    elif http_code in [301, 302]: value_score += 15

    if rel_type in ["DoFollow", "Domain Indexed"]: value_score += 35
    elif rel_type in ["NoFollow", "UGC", "Sponsored"]: value_score += 18

    value_score += int(da * 0.35)
    if url.startswith("https://"): value_score += 5
    value_score = max(0, min(100, value_score))
    
    risk_score = 0
    if http_code in [404, 500, 502, 503]: risk_score += 70
    if rel_type == "Missing Link": risk_score += 40
    if elapsed_ms > 4000: risk_score += 20
    if html_content and "noindex" in html_content.lower(): risk_score += 30

    risk_score = min(100, risk_score)
    return da, value_score, rel_type, risk_score

def determine_acquisition_type(title, description, url, html_content=''):
    """Classify backlink acquisition difficulty based on site signals."""
    text = (f"{title} {description} {url}").lower()
    html_lower = (html_content or '').lower()
    
    # Paid / Sponsored signals
    paid_keywords = ['sponsored', 'advertis', 'paid placement', 'partner', 'native ad', 'promo']
    if any(kw in text for kw in paid_keywords) or any(kw in html_lower for kw in paid_keywords):
        return 'Paid / Sponsored'
    
    # Outreach / Guest Post signals
    outreach_keywords = ['write for us', 'guest post', 'contribute', 'submit article', 'editorial', 'pitch us']
    if any(kw in html_lower for kw in outreach_keywords):
        return 'Persuasion / Outreach'
    
    # Directory / Profile signals
    directory_keywords = ['directory', 'listing', 'profile', 'register', 'free listing', 'add your business', 'catalog']
    if any(kw in text for kw in directory_keywords) or any(kw in html_lower for kw in directory_keywords):
        return 'Directory / Profile'
    
    # Default to Easy Do-Follow (open sites, blogs, communities)
    return 'Easy Do-Follow'

# Bot Inspector Worker Thread
class BotWorker(threading.Thread):
    def __init__(self, worker_id=0):
        super().__init__()
        self.daemon = True
        self.worker_id = worker_id
        self.name = f"BotWorker-{worker_id}"

    def log(self, link_id, message, level="info"):
        timestamp = datetime.now().strftime("%H:%M:%S")
        try:
            conn = sqlite3.connect(DB_PATH, timeout=10)
            cursor = conn.cursor()
            cursor.execute("INSERT INTO bot_logs (link_id, timestamp, message, level) VALUES (?, ?, ?, ?)",
                           (link_id, timestamp, message, level))
            cursor.execute("DELETE FROM bot_logs WHERE id NOT IN (SELECT id FROM bot_logs ORDER BY id DESC LIMIT 100)")
            conn.commit()
            conn.close()
        except Exception as log_err:
            print(f"[BOT-LOG-ERR] {log_err}", flush=True)

    def _get_ubersuggest_token(self):
        """Retrieve stored Ubersuggest OAuth token from bot_settings."""
        try:
            conn = sqlite3.connect(DB_PATH, timeout=5)
            cursor = conn.cursor()
            cursor.execute("SELECT value FROM bot_settings WHERE key = 'ubersuggest_access_token'")
            row = cursor.fetchone()
            conn.close()
            return row[0] if row else None
        except Exception:
            return None

    def ubersuggest_enrich(self, domain):
        """Call Ubersuggest MCP to get domain overview. Returns dict or None."""
        token = self._get_ubersuggest_token()
        if not token:
            return None
        try:
            # Extract root domain
            parsed = urllib.parse.urlparse(domain if domain.startswith('http') else 'https://' + domain)
            root_domain = parsed.netloc or parsed.path

            payload = json.dumps({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "get_domain_overview",
                    "arguments": {"domain": root_domain}
                }
            }).encode('utf-8')

            req = urllib.request.Request(
                UBERSUGGEST_MCP_URL,
                data=payload,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                    "Accept": "application/json, text/event-stream"
                },
                method="POST"
            )
            ctx = ssl._create_unverified_context()
            with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
                raw = resp.read().decode('utf-8')
                # Handle SSE format: lines starting with "data:"
                for line in raw.splitlines():
                    if line.startswith("data:"):
                        data_str = line[5:].strip()
                        if data_str and data_str != "[DONE]":
                            try:
                                rpc_resp = json.loads(data_str)
                                result = rpc_resp.get("result", {})
                                content = result.get("content", [])
                                if content and isinstance(content, list):
                                    text = content[0].get("text", "")
                                    return json.loads(text) if text else None
                            except Exception:
                                pass
                # Try direct JSON parse
                try:
                    rpc_resp = json.loads(raw)
                    result = rpc_resp.get("result", {})
                    content = result.get("content", [])
                    if content and isinstance(content, list):
                        text = content[0].get("text", "")
                        return json.loads(text) if text else None
                except Exception:
                    pass
        except Exception as e:
            print(f"[BOT-MCP] Ubersuggest enrichment error: {e}", flush=True)
        return None

    def run(self):
        import traceback
        print("[BOT] Inspector Worker started.", flush=True)
        agent_idx = 0

        while True:
            try:
                self._tick(agent_idx)
                agent_idx += 1
            except SystemExit:
                print("[BOT] SystemExit caught — worker stopping.", flush=True)
                break
            except BaseException as fatal_err:
                # Catch EVERYTHING — including MemoryError, KeyboardInterrupt etc.
                print(f"[BOT-FATAL] Unhandled exception in BotWorker: {fatal_err}", file=sys.stderr, flush=True)
                traceback.print_exc(file=sys.stderr)
                time.sleep(5)  # Back off, then keep running

    def _tick(self, agent_idx):
        """Single bot iteration — isolated so exceptions don't kill the loop."""
        try:
            conn = sqlite3.connect(DB_PATH, timeout=10)
            cursor = conn.cursor()

            cursor.execute("SELECT value FROM bot_settings WHERE key = 'status'")
            status_row = cursor.fetchone()
            bot_status = status_row[0] if status_row else "running"

            cursor.execute("SELECT value FROM bot_settings WHERE key = 'delay'")
            delay_row = cursor.fetchone()
            cursor.execute("SELECT value FROM bot_settings WHERE key = 'speed_mode'")
            speed_row = cursor.fetchone()
            turbo = speed_row and speed_row[0] == 'turbo'
            raw_delay = float(delay_row[0]) if delay_row else 2.0
            # Turbo mode: no floor. Normal: minimum 0.5s to be polite
            delay = max(0.0, raw_delay) if turbo else max(0.5, raw_delay)

            if bot_status != "running":
                conn.close()
                time.sleep(2)
                return

            cursor.execute("SELECT id, url, target_url FROM backlinks WHERE status IN ('Approved', 'Re-scan', 'Queued') ORDER BY id ASC LIMIT 1")
            row = cursor.fetchone()

            if not row:
                conn.close()
                time.sleep(3)
                return

            link_id, url, target_url = row
            cursor.execute("UPDATE backlinks SET status = 'Auditing' WHERE id = ?", (link_id,))
            conn.commit()
            conn.close()

        except Exception as db_err:
            print(f"[BOT-DB-ERR] {db_err}", flush=True)
            time.sleep(3)
            return

        # --- HTTP fetch (outside DB connection) ---
        ua = USER_AGENTS[agent_idx % len(USER_AGENTS)]
        req = urllib.request.Request(url, headers={'User-Agent': ua, 'Accept': 'text/html,application/xhtml+xml'})
        start_time = time.time()
        http_code = 0
        html_text = ""
        site_title = ""
        site_desc = ""
        elapsed_ms = 0

        ctx = ssl._create_unverified_context()

        try:
            with urllib.request.urlopen(req, timeout=8, context=ctx) as response:
                http_code = response.getcode()
                elapsed_ms = int((time.time() - start_time) * 1000)
                raw_data = response.read(65536)
                try:
                    html_text = raw_data.decode('utf-8', errors='ignore')
                except Exception:
                    html_text = ""

                soup = BeautifulSoup(html_text, 'html.parser')
                
                if soup.title and soup.title.string:
                    site_title = ' '.join(soup.title.string.split())[:120]
                
                desc_meta = soup.find('meta', attrs={'name': lambda x: x and x.lower() == 'description'})
                if not desc_meta:
                    desc_meta = soup.find('meta', attrs={'property': lambda x: x and x.lower() == 'og:description'})
                
                if desc_meta and desc_meta.get('content'):
                    site_desc = ' '.join(desc_meta['content'].split())[:200]
                
                # Append h1/h2 text to the html_text buffer so categorizer can use it
                headings = [h.get_text(separator=' ', strip=True) for h in soup.find_all(['h1', 'h2'])]
                if headings:
                    html_text += " " + " ".join(headings)


        except urllib.error.HTTPError as e:
            http_code = e.code
            elapsed_ms = int((time.time() - start_time) * 1000)
        except Exception as e:
            http_code = 0
            elapsed_ms = int((time.time() - start_time) * 1000)

        # Free HTML from memory immediately after parsing
        niche = categorize_niche(site_title, site_desc, url)
        da, val_score, rel_type, risk_score = calculate_metrics(url, http_code, elapsed_ms, html_text, target_url)
        final_status = "Active" if http_code in [200, 301, 302] else "Broken"
        acq_type = determine_acquisition_type(site_title, site_desc, url, html_text)
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
        html_text = ""  # Explicitly free memory

        # --- Ubersuggest MCP Enrichment ---
        mcp_data = self.ubersuggest_enrich(url)
        mcp_log = ""
        if mcp_data:
            try:
                # Ubersuggest may return traffic, keywords, da fields
                us_da = mcp_data.get("domain_score") or mcp_data.get("da") or mcp_data.get("authority_score")
                us_traffic = mcp_data.get("organic_monthly_traffic") or mcp_data.get("traffic") or mcp_data.get("estimated_visits")
                us_keywords = mcp_data.get("organic_keywords") or mcp_data.get("keywords_count") or mcp_data.get("keywords")
                us_niche = mcp_data.get("category") or mcp_data.get("industry")

                # Use Ubersuggest DA if it's more authoritative (higher weight)
                if us_da and int(us_da) > 0:
                    da = max(da, int(us_da))

                # Niche override from Ubersuggest if we got "Uncategorized"
                if us_niche and niche in ("General", "Uncategorized", ""):
                    niche = str(us_niche).title()

                parts = []
                if us_traffic: parts.append(f"Traffic≈{int(us_traffic):,}")
                if us_keywords: parts.append(f"KW≈{int(us_keywords):,}")
                if us_da: parts.append(f"US-DA:{int(us_da)}")
                mcp_log = " | UberSuggest: " + ", ".join(parts) if parts else " | UberSuggest: enriched"
            except Exception as mcp_parse_err:
                mcp_log = f" | MCP parse err: {mcp_parse_err}"

        # Boost value_score when traffic/keywords data is available (adds perspective)
        if mcp_data and val_score < 80:
            val_score = min(100, val_score + 5)

        # --- Write results back to DB ---
        try:
            conn = sqlite3.connect(DB_PATH, timeout=10)
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE backlinks SET
                    niche = ?, da_score = ?, value_score = ?, status = ?,
                    http_code = ?, rel_type = ?, site_title = ?, site_description = ?,
                    response_time_ms = ?, risk_score = ?, last_checked = ?, acquisition_type = ?
                WHERE id = ?
            ''', (niche, da, val_score, final_status, http_code, rel_type, site_title or url, site_desc, elapsed_ms, risk_score, now_str, acq_type, link_id))
            conn.commit()
            conn.close()
            print(f"[BOT-W{self.worker_id}] {url[:60]} → {final_status} | DA:{da} Score:{val_score}{mcp_log}", flush=True)
        except Exception as write_err:
            print(f"[BOT-WRITE-ERR] {write_err}", flush=True)

        time.sleep(delay)

class ReusableThreadingServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True

    def handle_error(self, request, client_address):
        # Suppress noisy broken pipe / reset errors at the server level
        import sys
        err = sys.exc_info()[1]
        if isinstance(err, (ConnectionResetError, BrokenPipeError, socket.timeout)):
            return
        super().handle_error(request, client_address)

# HTTP Request Handler
class RequestHandler(BaseHTTPRequestHandler):
    timeout = 10  # Drop idle connections to prevent thread leaks

    # Log incoming HTTP requests to stdout so they appear in Railway logs
    def log_message(self, format, *args):
        print(f"[HTTP] {format % args}", flush=True)

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (BrokenPipeError, ConnectionResetError, socket.timeout):
            pass  # Client disconnected / timed out — ignore
        except Exception as e:
            print(f"[REQ-ERR] {e}", flush=True)
        finally:
            # CRITICAL FIX for Railway 502s:
            # Force close_connection so Python doesn't wait for keep-alive.
            # Without this, proxy waits for EOF indefinitely because we don't send Content-Length.
            self.close_connection = True

    def _set_headers(self, status=200, content_type="application/json", cookie=None):
        try:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, HEAD")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Connection", "close")  # Tell the proxy we are done
            if cookie:
                self.send_header("Set-Cookie", cookie)
            self.end_headers()
        except Exception as e:
            print(f"[FATAL] _set_headers crashed: {e}", file=sys.stderr, flush=True)

    def do_OPTIONS(self):
        self._set_headers(200)

    def do_HEAD(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path == "/health":
            self._set_headers(200, "application/json")
        else:
            self._set_headers(200, "text/html")

    def do_GET(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path

            # Railway & Cloud Health Check Endpoint — PRIORITY 1 (No DB, No auth)
            if path == "/health":
                self._set_headers(200, "application/json")
                self.wfile.write(b'{"status":"ok","service":"backlink-vault"}')
                return

            query = urllib.parse.parse_qs(parsed.query)

            # Serve static files
            if path in ["/", "/index.html"]:
                return self._serve_file(os.path.join(STATIC_DIR, "index.html"), "text/html")
            elif path == "/styles.css":
                return self._serve_file(os.path.join(STATIC_DIR, "styles.css"), "text/css")
            elif path == "/app.js":
                return self._serve_file(os.path.join(STATIC_DIR, "app.js"), "application/javascript")

            # Google OAuth2 redirect callback — serve index.html so JS handles the hash token
            elif path in ["/api/auth/google/callback", "/auth/callback"]:
                return self._serve_file(os.path.join(STATIC_DIR, "index.html"), "text/html")

            # Favicon — serve empty to avoid 404 noise
            elif path == "/favicon.ico":
                self.send_response(204)
                self.end_headers()
                return

            current_user = get_auth_user(self.headers)

            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            if path == "/api/auth/me":
                if not current_user:
                    self._set_headers(401)
                    self.wfile.write(json.dumps({"error": "Unauthorized"}).encode('utf-8'))
                    conn.close()
                    return

                self._set_headers(200)
                self.wfile.write(json.dumps({"user": current_user}).encode('utf-8'))
                conn.close()
                return

            elif path == "/api/config":
                self._set_headers(200)
                self.wfile.write(json.dumps({
                    "admin_email": ADMIN_EMAIL
                }).encode('utf-8'))
                conn.close()
                return

            elif path == "/api/cms/pages":
                slug = query.get("slug", [""])[0]
                if slug:
                    cursor.execute("SELECT * FROM cms_pages WHERE slug = ?", (slug,))
                    row = cursor.fetchone()
                    res = dict(row) if row else {"error": "Page not found"}
                else:
                    cursor.execute("SELECT slug, title, updated_at FROM cms_pages ORDER BY title ASC")
                    rows = cursor.fetchall()
                    res = [dict(r) for r in rows]

                self._set_headers(200 if "error" not in res else 404)
                self.wfile.write(json.dumps(res).encode('utf-8'))
                conn.close()
                return

            elif path == "/api/cms/settings":
                cursor.execute("SELECT key, value FROM cms_settings")
                rows = cursor.fetchall()
                settings = {r['key']: r['value'] for r in rows}

                self._set_headers(200)
                self.wfile.write(json.dumps(settings).encode('utf-8'))
                conn.close()
                return

            elif path == "/api/personal-backlinks":
                if not current_user:
                    self._set_headers(401)
                    self.wfile.write(json.dumps({"error": "Login required"}).encode('utf-8'))
                    conn.close()
                    return

                project = query.get("project", [""])[0]
                sql = "SELECT * FROM personal_backlinks WHERE user_id = ?"
                params = [current_user['id']]
                if project:
                    sql += " AND project_name = ?"
                    params.append(project)

                sql += " ORDER BY id DESC"
                cursor.execute(sql, params)
                rows = cursor.fetchall()

                self._set_headers(200)
                self.wfile.write(json.dumps([dict(r) for r in rows]).encode('utf-8'))
                conn.close()
                return

            elif path == "/api/backlinks":
                search = query.get("search", [""])[0].lower()
                niche_filter = query.get("niche", ["All"])[0]
                status_filter = query.get("status", ["All"])[0]
                rel_filter = query.get("rel", ["All"])[0]
                acq_filter = query.get("acq", ["All"])[0]
                mine_only = query.get("mine", ["0"])[0] == "1"
                limit = int(query.get("limit", [100])[0])
                offset = int(query.get("offset", [0])[0])

                sql = "SELECT b.*, u.email as owner_email, u.name as owner_name FROM backlinks b LEFT JOIN users u ON b.user_id = u.id WHERE 1=1"
                params = []

                # Admin sees everything; regular users & guests see active, broken, auditing, approved, pending
                is_admin = current_user and current_user['role'] == 'admin'
                if not is_admin and not mine_only:
                    # Allow non-admin/guests to browse active, approved, auditing, broken
                    pass
                elif mine_only and current_user:
                    sql += " AND b.user_id = ?"
                    params.append(current_user['id'])

                if search:
                    sql += " AND (b.url LIKE ? OR b.site_title LIKE ? OR b.target_url LIKE ? OR b.anchor_text LIKE ?)"
                    params.extend([f"%{search}%", f"%{search}%", f"%{search}%", f"%{search}%"])

                if niche_filter != "All":
                    sql += " AND b.niche = ?"
                    params.append(niche_filter)

                if status_filter != "All":
                    sql += " AND b.status = ?"
                    params.append(status_filter)

                if rel_filter != "All":
                    if rel_filter == "DoFollow":
                        sql += " AND (b.rel_type = 'DoFollow' OR b.rel_type = 'Domain Indexed')"
                    else:
                        sql += " AND b.rel_type = ?"
                        params.append(rel_filter)

                if acq_filter != "All":
                    sql += " AND b.acquisition_type = ?"
                    params.append(acq_filter)

                sql += f" ORDER BY b.id DESC LIMIT {limit} OFFSET {offset}"
                cursor.execute(sql, params)
                rows = cursor.fetchall()
                results = [dict(r) for r in rows]

                self._set_headers(200)
                self.wfile.write(json.dumps(results).encode('utf-8'))
                conn.close()
                return

            elif path == "/api/admin/approvals":
                if not current_user or current_user['role'] != 'admin':
                    self._set_headers(403)
                    self.wfile.write(json.dumps({"error": "Admin access required"}).encode('utf-8'))
                    conn.close()
                    return

                limit = int(query.get("limit", [100])[0])
                cursor.execute(f'''
                    SELECT b.*, u.email as owner_email, u.name as owner_name
                    FROM backlinks b
                    LEFT JOIN users u ON b.user_id = u.id
                    WHERE b.status = 'Pending Approval'
                    ORDER BY b.id ASC LIMIT {limit}
                ''')
                rows = cursor.fetchall()
                results = [dict(r) for r in rows]

                self._set_headers(200)
                self.wfile.write(json.dumps(results).encode('utf-8'))
                conn.close()
                return

            elif path == "/api/admin/users":
                if not current_user or current_user['role'] != 'admin':
                    self._set_headers(403)
                    self.wfile.write(json.dumps({"error": "Admin access required"}).encode('utf-8'))
                    conn.close()
                    return

                cursor.execute('''
                    SELECT u.id, u.email, u.name, u.role, u.created_at,
                           COUNT(b.id) as backlinks_submitted
                    FROM users u
                    LEFT JOIN backlinks b ON b.user_id = u.id
                    GROUP BY u.id
                    ORDER BY u.created_at DESC
                ''')
                rows = cursor.fetchall()
                results = [dict(r) for r in rows]
                self._set_headers(200)
                self.wfile.write(json.dumps(results).encode('utf-8'))
                conn.close()
                return

            elif path.startswith("/api/admin/users/") and path.endswith("/delete"):
                if not current_user or current_user['role'] != 'admin':
                    self._set_headers(403)
                    self.wfile.write(json.dumps({"error": "Admin access required"}).encode('utf-8'))
                    conn.close()
                    return
                try:
                    uid = int(path.split("/")[-2])
                    cursor.execute("DELETE FROM users WHERE id = ?", (uid,))
                    cursor.execute("DELETE FROM sessions WHERE user_id = ?", (uid,))
                    conn.commit()
                    self._set_headers(200)
                    self.wfile.write(json.dumps({"ok": True}).encode('utf-8'))
                except Exception as e:
                    self._set_headers(500)
                    self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
                conn.close()
                return

            elif path == "/api/stats":
                cursor.execute("SELECT COUNT(*) FROM backlinks")
                total = cursor.fetchone()[0]

                cursor.execute("SELECT COUNT(*) FROM backlinks WHERE status = 'Active'")
                active = cursor.fetchone()[0]

                cursor.execute("SELECT COUNT(*) FROM backlinks WHERE status = 'Pending Approval'")
                pending_approval = cursor.fetchone()[0]

                cursor.execute("SELECT COUNT(*) FROM backlinks WHERE status IN ('Approved', 'Queued', 'Auditing')")
                bot_queue = cursor.fetchone()[0]

                cursor.execute("SELECT COUNT(*) FROM backlinks WHERE status = 'Broken'")
                broken = cursor.fetchone()[0]

                cursor.execute("SELECT AVG(da_score) FROM backlinks WHERE da_score > 0 LIMIT 5000")
                avg_da = round(cursor.fetchone()[0] or 0, 1)

                cursor.execute("SELECT AVG(value_score) FROM backlinks WHERE value_score > 0 LIMIT 5000")
                avg_val = round(cursor.fetchone()[0] or 0, 1)

                cursor.execute("SELECT niche, COUNT(*) as count FROM backlinks GROUP BY niche LIMIT 15")
                niche_rows = cursor.fetchall()
                niche_distribution = {r['niche']: r['count'] for r in niche_rows}

                stats = {
                    "total": total,
                    "active": active,
                    "pending_approval": pending_approval,
                    "bot_queue": bot_queue,
                    "broken": broken,
                    "avg_da": avg_da,
                    "avg_value": avg_val,
                    "niche_distribution": niche_distribution
                }

                self._set_headers(200)
                self.wfile.write(json.dumps(stats).encode('utf-8'))
                conn.close()
                return

            elif path == "/api/bot/status":
                cursor.execute("SELECT key, value FROM bot_settings")
                settings_rows = cursor.fetchall()
                settings = {r['key']: r['value'] for r in settings_rows}

                cursor.execute("SELECT COUNT(*) FROM backlinks WHERE status IN ('Approved', 'Queued', 'Auditing')")
                queue_count = cursor.fetchone()[0]

                cursor.execute("SELECT * FROM bot_logs ORDER BY id DESC LIMIT 50")
                log_rows = cursor.fetchall()

                has_ubersuggest = bool(settings.get("ubersuggest_access_token"))

                res = {
                    "status": settings.get("status", "running"),
                    "delay": float(settings.get("delay", str(DEFAULT_BOT_DELAY))),
                    "workers": int(settings.get("workers", "1")),
                    "speed_mode": settings.get("speed_mode", "normal"),
                    "queue_count": queue_count,
                    "ubersuggest_connected": has_ubersuggest,
                    "logs": [dict(r) for r in log_rows]
                }

                self._set_headers(200)
                self.wfile.write(json.dumps(res).encode('utf-8'))
                conn.close()
                return

            elif path == "/api/admin/ubersuggest/connect":
                if not current_user or current_user['role'] != 'admin':
                    self._set_headers(403)
                    self.wfile.write(json.dumps({"error": "Admin access required"}).encode('utf-8'))
                    conn.close()
                    return

                # PKCE generation
                verifier = secrets.token_urlsafe(32)
                digest = hashlib.sha256(verifier.encode('utf-8')).digest()
                challenge = base64.urlsafe_b64encode(digest).decode('utf-8').rstrip('=')

                cursor.execute("INSERT OR REPLACE INTO bot_settings (key, value) VALUES ('ubersuggest_code_verifier', ?)", (verifier,))
                conn.commit()

                # Build redirect URL dynamically based on Host header if present
                host = self.headers.get("Host", "backlink-vault.up.railway.app")
                scheme = "https" if "railway" in host or "herokuapp" in host or "render" in host else "http"
                redirect_uri = f"{scheme}://{host}/oauth/ubersuggest/callback"

                params = {
                    "response_type": "code",
                    "client_id": UBERSUGGEST_CLIENT_ID,
                    "redirect_uri": redirect_uri,
                    "scope": UBERSUGGEST_SCOPE,
                    "code_challenge": challenge,
                    "code_challenge_method": "S256"
                }
                auth_redirect_url = UBERSUGGEST_AUTH_URL + "?" + urllib.parse.urlencode(params)

                self.send_response(302)
                self.send_header("Location", auth_redirect_url)
                self.end_headers()
                conn.close()
                return

            elif path == "/oauth/ubersuggest/callback":
                code = query.get("code", [None])[0]
                if not code:
                    self._set_headers(400)
                    self.wfile.write(json.dumps({"error": "Missing authorization code"}).encode('utf-8'))
                    conn.close()
                    return

                cursor.execute("SELECT value FROM bot_settings WHERE key = 'ubersuggest_code_verifier'")
                v_row = cursor.fetchone()
                verifier = v_row[0] if v_row else ""

                host = self.headers.get("Host", "backlink-vault.up.railway.app")
                scheme = "https" if "railway" in host or "herokuapp" in host or "render" in host else "http"
                redirect_uri = f"{scheme}://{host}/oauth/ubersuggest/callback"

                token_payload = urllib.parse.urlencode({
                    "grant_type": "authorization_code",
                    "client_id": UBERSUGGEST_CLIENT_ID,
                    "code": code,
                    "redirect_uri": redirect_uri,
                    "code_verifier": verifier
                }).encode('utf-8')

                req = urllib.request.Request(
                    UBERSUGGEST_TOKEN_URL,
                    data=token_payload,
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                    method="POST"
                )
                ctx = ssl._create_unverified_context()
                try:
                    with urllib.request.urlopen(req, timeout=10, context=ctx) as response:
                        token_resp = json.loads(response.read().decode('utf-8'))
                        access_token = token_resp.get("access_token")
                        if access_token:
                            cursor.execute("INSERT OR REPLACE INTO bot_settings (key, value) VALUES ('ubersuggest_access_token', ?)", (access_token,))
                            conn.commit()

                    self.send_response(302)
                    self.send_header("Location", "/?ubersuggest=connected")
                    self.end_headers()
                except Exception as ex:
                    self._set_headers(500)
                    self.wfile.write(json.dumps({"error": f"Failed to exchange token: {str(ex)}"}).encode('utf-8'))
                
                conn.close()
                return

            elif path == "/api/admin/ubersuggest/disconnect":
                if not current_user or current_user['role'] != 'admin':
                    self._set_headers(403)
                    self.wfile.write(json.dumps({"error": "Admin access required"}).encode('utf-8'))
                    conn.close()
                    return
                cursor.execute("DELETE FROM bot_settings WHERE key = 'ubersuggest_access_token'")
                conn.commit()
                self._set_headers(200)
                self.wfile.write(json.dumps({"ok": True}).encode('utf-8'))
                conn.close()
                return

            elif path == "/api/admin/ubersuggest/token":
                # Allow admin to manually paste an access token
                if not current_user or current_user['role'] != 'admin':
                    self._set_headers(403)
                    self.wfile.write(json.dumps({"error": "Admin access required"}).encode('utf-8'))
                    conn.close()
                    return
                token = data.get("token", "").strip()
                if not token:
                    self._set_headers(400)
                    self.wfile.write(json.dumps({"error": "Token required"}).encode('utf-8'))
                    conn.close()
                    return
                cursor.execute("INSERT OR REPLACE INTO bot_settings (key, value) VALUES ('ubersuggest_access_token', ?)", (token,))
                conn.commit()
                self._set_headers(200)
                self.wfile.write(json.dumps({"ok": True}).encode('utf-8'))
                conn.close()
                return

            elif path == "/api/admin/restart":
                # Restart the server process (Railway will keep it alive)
                if not current_user or current_user['role'] != 'admin':
                    self._set_headers(403)
                    self.wfile.write(json.dumps({"error": "Admin access required"}).encode('utf-8'))
                    conn.close()
                    return
                self._set_headers(200)
                self.wfile.write(json.dumps({"ok": True, "message": "Server restarting in 2s..."}).encode('utf-8'))
                conn.close()
                # Schedule restart after response is sent
                def do_restart():
                    time.sleep(2)
                    os.execv(sys.executable, [sys.executable] + sys.argv)
                threading.Thread(target=do_restart, daemon=True).start()
                return

            elif path == "/api/user/delete-account":
                if not current_user:
                    self._set_headers(401)
                    self.wfile.write(json.dumps({"error": "Authentication required"}).encode('utf-8'))
                    conn.close()
                    return
                # Delete all user data and the account itself
                uid = current_user['id']
                cursor.execute("DELETE FROM personal_backlinks WHERE user_id = ?", (uid,))
                cursor.execute("DELETE FROM sessions WHERE user_id = ?", (uid,))
                cursor.execute("DELETE FROM users WHERE id = ?", (uid,))
                conn.commit()
                self._set_headers(200)
                self.wfile.write(json.dumps({"ok": True, "message": "Account deleted successfully"}).encode('utf-8'))
                conn.close()
                return

            elif path == "/api/user/change-password":
                if not current_user:
                    self._set_headers(401)
                    self.wfile.write(json.dumps({"error": "Authentication required"}).encode('utf-8'))
                    conn.close()
                    return
                current_pw = data.get("current_password", "")
                new_pw = data.get("new_password", "").strip()
                if len(new_pw) < 6:
                    self._set_headers(400)
                    self.wfile.write(json.dumps({"error": "New password must be at least 6 characters"}).encode('utf-8'))
                    conn.close()
                    return
                cursor.execute("SELECT password_hash FROM users WHERE id = ?", (current_user['id'],))
                row = cursor.fetchone()
                if not row or hashlib.sha256(current_pw.encode()).hexdigest() != row[0]:
                    self._set_headers(403)
                    self.wfile.write(json.dumps({"error": "Current password is incorrect"}).encode('utf-8'))
                    conn.close()
                    return
                new_hash = hashlib.sha256(new_pw.encode()).hexdigest()
                cursor.execute("UPDATE users SET password_hash = ? WHERE id = ?", (new_hash, current_user['id']))
                conn.commit()
                self._set_headers(200)
                self.wfile.write(json.dumps({"ok": True}).encode('utf-8'))
                conn.close()
                return

            elif path == "/api/export/csv":
                if not current_user or current_user['role'] != 'admin':
                    self._set_headers(403)
                    self.wfile.write(json.dumps({"error": "Admin access required to export"}).encode('utf-8'))
                    conn.close()
                    return

                cursor.execute("SELECT id, url, target_url, anchor_text, niche, da_score, value_score, rel_type, status, http_code, last_checked FROM backlinks ORDER BY id DESC")
                rows = cursor.fetchall()

                self.send_response(200)
                self.send_header("Content-Type", "text/csv")
                self.send_header("Content-Disposition", "attachment; filename=backlink_vault_export.csv")
                self.end_headers()

                self.wfile.write("ID,URL,Target URL,Anchor Text,Niche,DA Score,Value Score,Rel Type,Status,HTTP Code,Last Checked\n".encode('utf-8'))
                for r in rows:
                    line = f'"{r[0]}","{r[1]}","{r[2]}","{r[3]}","{r[4]}",{r[5]},{r[6]},"{r[7]}","{r[8]}",{r[9]},"{r[10]}"\n'
                    self.wfile.write(line.encode('utf-8'))

                conn.close()
                return

            conn.close()
            self._set_headers(404)
            self.wfile.write(json.dumps({"error": "Endpoint not found"}).encode('utf-8'))
        except Exception as e:
            print(f"[FATAL] do_GET crashed on {self.path}: {e}", file=sys.stderr, flush=True)
            import traceback
            traceback.print_exc(file=sys.stderr)
            try:
                self._set_headers(500)
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
            except Exception: pass

    def do_POST(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path

            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8') if content_length > 0 else "{}"
            
            try: data = json.loads(body)
            except Exception: data = {}

            current_user = get_auth_user(self.headers)
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            if path == "/api/auth/register":
                email = data.get("email", "").strip().lower()
                password = data.get("password", "")
                name = data.get("name", "").strip() or email.split('@')[0]

                if not email or "@" not in email or len(password) < 6:
                    self._set_headers(400)
                    self.wfile.write(json.dumps({"error": "Valid email and password (min 6 chars) required"}).encode('utf-8'))
                    conn.close()
                    return

                pass_hash, salt = hash_password(password)
                now_str = datetime.now().strftime("%Y-%m-%d %H:%M")

                try:
                    cursor.execute('''
                        INSERT INTO users (email, password_hash, salt, name, auth_provider, role, created_at)
                        VALUES (?, ?, ?, ?, 'local', 'user', ?)
                    ''', (email, pass_hash, salt, name, now_str))
                    conn.commit()
                    user_id = cursor.lastrowid

                    token = secrets.token_hex(32)
                    exp = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d %H:%M")
                    cursor.execute("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                                   (token, user_id, now_str, exp))
                    conn.commit()

                    self._set_headers(201, cookie=f"vault_token={token}; Path=/; HttpOnly")
                    self.wfile.write(json.dumps({
                        "token": token,
                        "user": {"id": user_id, "email": email, "name": name, "role": "user"}
                    }).encode('utf-8'))
                except sqlite3.IntegrityError:
                    self._set_headers(400)
                    self.wfile.write(json.dumps({"error": "Email address already registered"}).encode('utf-8'))

                conn.close()
                return

            elif path == "/api/auth/login":
                email = data.get("email", "").strip().lower()
                password = data.get("password", "")

                cursor.execute("SELECT * FROM users WHERE email = ?", (email,))
                user = cursor.fetchone()

                if not user:
                    self._set_headers(400)
                    self.wfile.write(json.dumps({"error": "Invalid email or password"}).encode('utf-8'))
                    conn.close()
                    return

                user_dict = dict(user)
                calc_hash, _ = hash_password(password, user_dict['salt'])

                if calc_hash != user_dict['password_hash']:
                    self._set_headers(400)
                    self.wfile.write(json.dumps({"error": "Invalid email or password"}).encode('utf-8'))
                    conn.close()
                    return

                token = secrets.token_hex(32)
                now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
                exp = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d %H:%M")

                cursor.execute("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                               (token, user_dict['id'], now_str, exp))
                conn.commit()

                self._set_headers(200, cookie=f"vault_token={token}; Path=/; HttpOnly")
                self.wfile.write(json.dumps({
                    "token": token,
                    "user": {"id": user_dict['id'], "email": user_dict['email'], "name": user_dict['name'], "role": user_dict['role']}
                }).encode('utf-8'))
                conn.close()
                return

            elif path == "/api/auth/google":
                email = data.get("email", "").strip().lower()
                name = data.get("name", "") or email.split('@')[0]
                avatar = data.get("picture", "")

                if not email:
                    self._set_headers(400)
                    self.wfile.write(json.dumps({"error": "Google profile email missing"}).encode('utf-8'))
                    conn.close()
                    return

                is_admin_email = (email.lower() == ADMIN_EMAIL.lower())
                assigned_role = 'admin' if is_admin_email else 'user'

                cursor.execute("SELECT * FROM users WHERE email = ?", (email,))
                user = cursor.fetchone()

                now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
                if not user:
                    cursor.execute('''
                        INSERT INTO users (email, name, auth_provider, role, avatar_url, created_at)
                        VALUES (?, ?, 'google', ?, ?, ?)
                    ''', (email, name, assigned_role, avatar, now_str))
                    conn.commit()
                    user_id = cursor.lastrowid
                    user_role = assigned_role
                else:
                    user_dict = dict(user)
                    user_id = user_dict['id']
                    if is_admin_email and user_dict['role'] != 'admin':
                        cursor.execute("UPDATE users SET role = 'admin' WHERE id = ?", (user_id,))
                        conn.commit()
                        user_role = 'admin'
                    else:
                        user_role = user_dict['role']

                token = secrets.token_hex(32)
                exp = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d %H:%M")
                cursor.execute("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                               (token, user_id, now_str, exp))
                conn.commit()

                self._set_headers(200, cookie=f"vault_token={token}; Path=/; HttpOnly")
                self.wfile.write(json.dumps({
                    "token": token,
                    "user": {"id": user_id, "email": email, "name": name, "role": user_role, "avatar_url": avatar}
                }).encode('utf-8'))
                conn.close()
                return

            elif path == "/api/auth/logout":
                auth_header = self.headers.get('Authorization', '')
                if auth_header.startswith('Bearer '):
                    t = auth_header.split('Bearer ')[1].strip()
                    cursor.execute("DELETE FROM sessions WHERE token = ?", (t,))
                    conn.commit()

                self._set_headers(200, cookie="vault_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT")
                self.wfile.write(json.dumps({"success": True}).encode('utf-8'))
                conn.close()
                return

            elif path == "/api/backlinks":
                if not current_user:
                    self._set_headers(401)
                    self.wfile.write(json.dumps({"error": "Please log in to submit backlinks"}).encode('utf-8'))
                    conn.close()
                    return

                raw_url = data.get("url", "").strip()
                target_url = data.get("target_url", "").strip()
                anchor_text = data.get("anchor_text", "").strip()
                notes = data.get("notes", "").strip()

                url = normalize_to_main_domain(raw_url)

                if not url or not url.startswith("http"):
                    self._set_headers(400)
                    self.wfile.write(json.dumps({"error": "Valid URL starting with http:// or https:// is required"}).encode('utf-8'))
                    conn.close()
                    return

                now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
                initial_status = "Approved" if current_user['role'] == 'admin' else "Pending Approval"

                try:
                    cursor.execute('''
                        INSERT INTO backlinks (url, target_url, anchor_text, created_at, notes, status, user_id)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    ''', (url, target_url, anchor_text, now_str, notes, initial_status, current_user['id']))
                    conn.commit()
                    new_id = cursor.lastrowid
                    
                    msg = f"Main domain '{url}' approved and queued for audit!" if initial_status == "Approved" else f"Main domain '{url}' submitted! Sent to Admin for final approval."
                    self._set_headers(201)
                    self.wfile.write(json.dumps({"success": True, "id": new_id, "status": initial_status, "message": msg}).encode('utf-8'))
                except sqlite3.IntegrityError:
                    self._set_headers(400)
                    self.wfile.write(json.dumps({"error": f"Domain '{url}' already exists in vault"}).encode('utf-8'))

                conn.close()
                return

            elif path == "/api/backlinks/bulk":
                if not current_user:
                    self._set_headers(401)
                    self.wfile.write(json.dumps({"error": "Please log in to import links"}).encode('utf-8'))
                    conn.close()
                    return

                urls_text = data.get("urls_text", "")
                target_url = data.get("target_url", "")
                
                lines = [l.strip() for l in urls_text.splitlines() if l.strip()]
                added_count = 0
                now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
                initial_status = "Approved" if current_user['role'] == 'admin' else "Pending Approval"

                for line in lines:
                    if "Target URL" in line and "Niche" in line:
                        continue
                        
                    found_urls = re.findall(r'https?://[^\s,"\'<>]+', line)
                    
                    if not found_urls:
                        parts = [p.strip('"\' ') for p in line.split(',')]
                        for p in parts:
                            if "." in p and not p.isdigit() and len(p) > 4:
                                found_urls.append("https://" + p)
                                break

                    if found_urls:
                        raw_u = found_urls[0]
                        u = normalize_to_main_domain(raw_u)
                        t_url = found_urls[1] if len(found_urls) > 1 else target_url
                        anc = ""
                        
                        try:
                            cursor.execute("INSERT INTO backlinks (url, target_url, anchor_text, created_at, status, user_id) VALUES (?, ?, ?, ?, ?, ?)",
                                           (u, t_url, anc, now_str, initial_status, current_user['id']))
                            added_count += 1
                        except sqlite3.IntegrityError: pass

                conn.commit()
                conn.close()

                self._set_headers(200)
                self.wfile.write(json.dumps({"success": True, "added_count": added_count, "status": initial_status}).encode('utf-8'))
                return

            elif path.startswith("/api/admin/backlinks/") and path.endswith("/approve"):
                if not current_user or current_user['role'] != 'admin':
                    self._set_headers(403)
                    self.wfile.write(json.dumps({"error": "Admin access required"}).encode('utf-8'))
                    conn.close()
                    return

                link_id = path.split('/')[4]
                cursor.execute("UPDATE backlinks SET status = 'Approved' WHERE id = ?", (link_id,))
                conn.commit()
                conn.close()

                self._set_headers(200)
                self.wfile.write(json.dumps({"success": True, "message": "Link approved and sent to Tiny Bot queue!"}).encode('utf-8'))
                return

            elif path.startswith("/api/admin/backlinks/") and path.endswith("/reject"):
                if not current_user or current_user['role'] != 'admin':
                    self._set_headers(403)
                    self.wfile.write(json.dumps({"error": "Admin access required"}).encode('utf-8'))
                    conn.close()
                    return

                link_id = path.split('/')[4]
                note = data.get("note", "Declined by Admin")
                cursor.execute("UPDATE backlinks SET status = 'Rejected', rejection_note = ? WHERE id = ?", (note, link_id))
                conn.commit()
                conn.close()

            elif path == "/api/admin/backlinks/rescan":
                if not current_user or current_user['role'] != 'admin':
                    self._set_headers(403)
                    self.wfile.write(json.dumps({"error": "Admin access required"}).encode('utf-8'))
                    conn.close()
                    return

                ids = data.get("ids", [])
                rescan_all = data.get("rescan_all", False)

                if rescan_all:
                    cursor.execute("UPDATE backlinks SET status = 'Re-scan' WHERE status != 'Pending Approval'")
                    updated_count = cursor.rowcount
                elif ids:
                    placeholders = ','.join(['?'] * len(ids))
                    cursor.execute(f"UPDATE backlinks SET status = 'Re-scan' WHERE id IN ({placeholders})", ids)
                    updated_count = cursor.rowcount
                else:
                    updated_count = 0

                conn.commit()
                conn.close()

                self._set_headers(200)
                self.wfile.write(json.dumps({"success": True, "count": updated_count, "message": f"{updated_count} domains queued for Bot re-scan!"}).encode('utf-8'))
                return

            elif path == "/api/bot/settings":
                if not current_user or current_user['role'] != 'admin':
                    self._set_headers(403)
                    self.wfile.write(json.dumps({"error": "Admin access required"}).encode('utf-8'))
                    conn.close()
                    return

                status     = data.get("status")
                delay      = data.get("delay")
                workers    = data.get("workers")
                speed_mode = data.get("speed_mode")

                if status in ["running", "paused"]:
                    cursor.execute("INSERT OR REPLACE INTO bot_settings (key, value) VALUES ('status', ?)", (status,))
                if delay is not None:
                    cursor.execute("INSERT OR REPLACE INTO bot_settings (key, value) VALUES ('delay', ?)", (str(delay),))
                if workers is not None:
                    clamped = min(5, max(1, int(workers)))
                    cursor.execute("INSERT OR REPLACE INTO bot_settings (key, value) VALUES ('workers', ?)", (str(clamped),))
                if speed_mode in ["normal", "turbo"]:
                    cursor.execute("INSERT OR REPLACE INTO bot_settings (key, value) VALUES ('speed_mode', ?)", (speed_mode,))

                conn.commit()
                conn.close()

                self._set_headers(200)
                self.wfile.write(json.dumps({"success": True}).encode('utf-8'))
                return

            elif path == "/api/cms/pages":
                if not current_user or current_user['role'] != 'admin':
                    self._set_headers(403)
                    self.wfile.write(json.dumps({"error": "Admin access required"}).encode('utf-8'))
                    conn.close()
                    return

                slug = data.get("slug", "").strip().lower()
                title = data.get("title", "").strip()
                content_html = data.get("content_html", "").strip()
                now_str = datetime.now().strftime("%Y-%m-%d %H:%M")

                if not slug or not title:
                    self._set_headers(400)
                    self.wfile.write(json.dumps({"error": "Slug and title required"}).encode('utf-8'))
                    conn.close()
                    return

                cursor.execute('''
                    INSERT INTO cms_pages (slug, title, content_html, updated_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(slug) DO UPDATE SET title=excluded.title, content_html=excluded.content_html, updated_at=excluded.updated_at
                ''', (slug, title, content_html, now_str))
                conn.commit()

                self._set_headers(200)
                self.wfile.write(json.dumps({"success": True, "slug": slug}).encode('utf-8'))
                conn.close()
                return

            elif path == "/api/cms/settings":
                if not current_user or current_user['role'] != 'admin':
                    self._set_headers(403)
                    self.wfile.write(json.dumps({"error": "Admin access required"}).encode('utf-8'))
                    conn.close()
                    return

                for key, val in data.items():
                    cursor.execute('''
                        INSERT INTO cms_settings (key, value) VALUES (?, ?)
                        ON CONFLICT(key) DO UPDATE SET value=excluded.value
                    ''', (str(key), str(val)))

                conn.commit()
                self._set_headers(200)
                self.wfile.write(json.dumps({"success": True}).encode('utf-8'))
                conn.close()
                return

            elif path == "/api/personal-backlinks":
                if not current_user:
                    self._set_headers(401)
                    self.wfile.write(json.dumps({"error": "Login required"}).encode('utf-8'))
                    conn.close()
                    return

                p_id = data.get("id")
                project_name = data.get("project_name", "General").strip() or "General"
                backlink_url = data.get("backlink_url", "").strip()
                target_url = data.get("target_url", "").strip()
                anchor_text = data.get("anchor_text", "").strip()
                acq_type = data.get("acquisition_type", "Easy Do-Follow")
                status = data.get("status", "Live")
                da_score = int(data.get("da_score", 0))
                notes = data.get("notes", "").strip()
                now_str = datetime.now().strftime("%Y-%m-%d %H:%M")

                if not backlink_url:
                    self._set_headers(400)
                    self.wfile.write(json.dumps({"error": "Backlink URL is required"}).encode('utf-8'))
                    conn.close()
                    return

                if p_id:
                    cursor.execute('''
                        UPDATE personal_backlinks SET
                            project_name=?, backlink_url=?, target_url=?, anchor_text=?,
                            acquisition_type=?, status=?, da_score=?, notes=?, updated_at=?
                        WHERE id=? AND user_id=?
                    ''', (project_name, backlink_url, target_url, anchor_text, acq_type, status, da_score, notes, now_str, p_id, current_user['id']))
                else:
                    cursor.execute('''
                        INSERT INTO personal_backlinks (user_id, project_name, backlink_url, target_url, anchor_text, acquisition_type, status, da_score, notes, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ''', (current_user['id'], project_name, backlink_url, target_url, anchor_text, acq_type, status, da_score, notes, now_str, now_str))

                conn.commit()
                self._set_headers(200)
                self.wfile.write(json.dumps({"success": True}).encode('utf-8'))
                conn.close()
                return

            conn.close()
            self._set_headers(404)
            self.wfile.write(json.dumps({"error": "Endpoint not found"}).encode('utf-8'))
        except Exception as e:
            print(f"[FATAL] do_POST crashed on {self.path}: {e}", file=sys.stderr, flush=True)
            import traceback
            traceback.print_exc(file=sys.stderr)
            try:
                self._set_headers(500)
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
            except Exception: pass

    def do_DELETE(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path

            if path.startswith("/api/backlinks/"):
                current_user = get_auth_user(self.headers)
                if not current_user:
                    self._set_headers(401)
                    return

                link_id = path.split('/')[-1]
                conn = sqlite3.connect(DB_PATH, timeout=10)
                cursor = conn.cursor()

                if current_user['role'] == 'admin':
                    cursor.execute("DELETE FROM backlinks WHERE id = ?", (link_id,))
                else:
                    cursor.execute("DELETE FROM backlinks WHERE id = ? AND user_id = ?", (link_id, current_user['id']))

                conn.commit()
                conn.close()

                self._set_headers(200)
                self.wfile.write(json.dumps({"success": True}).encode('utf-8'))
                return

            elif path.startswith("/api/personal-backlinks/"):
                current_user = get_auth_user(self.headers)
                if not current_user:
                    self._set_headers(401)
                    return

                link_id = path.split('/')[-1]
                conn = sqlite3.connect(DB_PATH, timeout=10)
                cursor = conn.cursor()
                cursor.execute("DELETE FROM personal_backlinks WHERE id = ? AND user_id = ?", (link_id, current_user['id']))
                conn.commit()
                conn.close()

                self._set_headers(200)
                self.wfile.write(json.dumps({"success": True}).encode('utf-8'))
                return

            self._set_headers(404)
        except Exception as e:
            print(f"[FATAL] do_DELETE crashed: {e}", file=sys.stderr, flush=True)
            import traceback
            traceback.print_exc(file=sys.stderr)

    def _serve_file(self, file_path, content_type):
        try:
            if not os.path.exists(file_path):
                self._set_headers(404)
                self.wfile.write(b"File not found")
                return

            with open(file_path, "rb") as f:
                content = f.read()

            self._set_headers(200, content_type)
            self.wfile.write(content)
        except Exception as e:
            print(f"[FATAL] _serve_file failed for {file_path}: {e}", file=sys.stderr, flush=True)

class HeartbeatWorker(threading.Thread):
    def __init__(self):
        super().__init__()
        self.daemon = True
        self.name = "HeartbeatWorker"

    def run(self):
        uptime = 0
        while True:
            time.sleep(5)
            uptime += 5
            print(f"[ALIVE] {datetime.now().strftime('%H:%M:%S')} (Uptime: {uptime}s)", flush=True)

def run_server(port=None):
    import traceback

    if port is None:
        port = PORT

    print(f"[STARTUP] Python {sys.version}", flush=True)
    print(f"[STARTUP] BASE_DIR: {BASE_DIR}", flush=True)
    print(f"[STARTUP] DB_PATH:  {DB_PATH}", flush=True)
    print(f"[STARTUP] PORT:     {port}", flush=True)
    print(f"[STARTUP] ADMIN:    {ADMIN_EMAIL}", flush=True)

    # --- Init Database ---
    try:
        print("[STARTUP] Initialising database...", flush=True)
        init_db()
        print("[STARTUP] Database OK", flush=True)
    except Exception as e:
        print(f"[FATAL] init_db() failed: {e}", flush=True)
        traceback.print_exc()
        sys.exit(1)

    # --- Start Heartbeat Worker ---
    try:
        hb = HeartbeatWorker()
        hb.start()
        print("[STARTUP] Heartbeat thread started (5s ping)", flush=True)
    except Exception as e:
        print(f"[WARN] Heartbeat thread failed: {e}", flush=True)

    # --- Start Bot Workers (multi-worker for parallel scanning) ---
    try:
        conn_init = sqlite3.connect(DB_PATH, timeout=10)
        cur_init = conn_init.cursor()
        cur_init.execute("SELECT value FROM bot_settings WHERE key = 'workers'")
        w_row = cur_init.fetchone()
        num_workers = min(5, max(1, int(w_row[0]) if w_row else 1))
        conn_init.close()
    except Exception:
        num_workers = 1

    try:
        print(f"[STARTUP] Starting {num_workers} BotWorker thread(s)...", flush=True)
        for wid in range(num_workers):
            w = BotWorker(worker_id=wid)
            w.daemon = True
            w.start()
        print(f"[STARTUP] {num_workers} BotWorker(s) started", flush=True)
    except Exception as e:
        print(f"[FATAL] BotWorker failed to start: {e}", flush=True)
        traceback.print_exc()
        sys.exit(1)

    # --- Start Threading HTTP Server ---
    try:
        server_address = ('0.0.0.0', port)
        httpd = ReusableThreadingServer(server_address, RequestHandler)
        print(f"[STARTUP] ReusableThreadingServer listening on http://0.0.0.0:{port}", flush=True)
        print(f"[STARTUP] Health check: http://0.0.0.0:{port}/health", flush=True)
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[SHUTDOWN] Keyboard interrupt — shutting down.", flush=True)
        httpd.server_close()
    except Exception as e:
        print(f"[FATAL] serve_forever() crashed: {e}", file=sys.stderr, flush=True)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    port_arg = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    run_server(port_arg)

