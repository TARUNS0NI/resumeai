from flask import Flask, render_template, request, jsonify, session, redirect, url_for
import os, pdfplumber, sqlite3, requests, json, re, uuid, time
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

app = Flask(__name__)
app.secret_key = "resumeai_secret_2024_x9k"
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_URL     = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL        = "qwen/qwen3.8-27b"
GROQ_MODEL_BACKUP = "groq/compound"


chat_store = {}

def friendly_error(e):
    msg = str(e).lower()
    if "getaddrinfo" in msg or "nameresolution" in msg or "failed to resolve" in msg:
        return "Unable to connect to AI service. Please check your internet connection."
    if "max retries" in msg or "timed out" in msg or "timeout" in msg:
        return "Connection timed out. Your internet may be slow — please try again."
    if "403" in msg or "forbidden" in msg:
        return "AI service access denied. Your API key may have expired."
    if "429" in msg or "rate limit" in msg:
        return "Too many requests. Please wait 30 seconds and try again."
    if "401" in msg or "unauthorized" in msg:
        return "Invalid API key. Please update your Groq API key in app.py."
    if "500" in msg:
        return "The AI service is temporarily unavailable. Please try again."
    if "parse" in msg or "json" in msg:
        return "The AI returned an unexpected response. Please try again."
    return "Something went wrong. Please check your connection and try again."

def init_db():
    conn = sqlite3.connect('resumes.db')
    conn.execute('''CREATE TABLE IF NOT EXISTS users (
        uid TEXT PRIMARY KEY, name TEXT, email TEXT,
        photo TEXT, provider TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    conn.execute('''CREATE TABLE IF NOT EXISTS results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT, filename TEXT,
        overall_score INTEGER, jd_score TEXT,
        ats_score INTEGER, best_match TEXT, summary TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    conn.commit(); conn.close()

def upsert_user(uid, name, email, photo, provider):
    conn = sqlite3.connect('resumes.db')
    conn.execute('''INSERT INTO users (uid,name,email,photo,provider)
        VALUES (?,?,?,?,?) ON CONFLICT(uid) DO UPDATE SET
        name=excluded.name,email=excluded.email,photo=excluded.photo,provider=excluded.provider''',
        (uid, name, email, photo, provider))
    conn.commit(); conn.close()

def save_result(uid, filename, overall_score, jd_score, ats_score, best_match, summary):
    conn = sqlite3.connect('resumes.db')
    conn.execute("INSERT INTO results (uid,filename,overall_score,jd_score,ats_score,best_match,summary) VALUES (?,?,?,?,?,?,?)",
        (uid, filename, overall_score, jd_score, ats_score, best_match, summary))
    conn.commit(); conn.close()

def get_history(uid):
    conn = sqlite3.connect('resumes.db')
    rows = conn.execute("SELECT * FROM results WHERE uid=? ORDER BY created_at DESC LIMIT 20",(uid,)).fetchall()
    conn.close()
    cols = ['id','uid','filename','overall_score','jd_score','ats_score','best_match','summary','created_at']
    return [dict(zip(cols,r)) for r in rows]

def get_current_user(): return session.get('user')

def login_required(f):
    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('user'):
            # API routes return 401 JSON, page routes redirect
            if request.path.startswith('/analyze') or                request.path.startswith('/chat') or                request.path.startswith('/roadmap') or                request.path.startswith('/rewrite') or                request.path.startswith('/interview') or                request.path.startswith('/coverletter') or                request.path.startswith('/compare') or                request.path.startswith('/history') and request.method == 'GET' and request.accept_mimetypes.best == 'application/json':
                return jsonify({'error': 'Not authenticated'}), 401
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated

def is_guest():
    return session.get('user', {}).get('is_guest', False)

def extract_text(filepath):
    text = ""
    with pdfplumber.open(filepath) as pdf:
        for page in pdf.pages:
            t = page.extract_text()
            if t: text += t + "\n"
    return re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]',' ',text).strip()

def clean_json(raw):
    raw = raw.replace("```json","").replace("```","").strip()
    m = re.search(r'\{[\s\S]*\}',raw)
    if m: raw = m.group(0)
    raw = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]',' ',raw)
    result=[]; in_string=False; escape=False
    for ch in raw:
        if escape: result.append(ch); escape=False
        elif ch=='\\': result.append(ch); escape=True
        elif ch=='"' and not escape: in_string=not in_string; result.append(ch)
        elif in_string and ch=='\n': result.append('\\n')
        elif in_string and ch=='\r': result.append('\\r')
        elif in_string and ch=='\t': result.append('\\t')
        else: result.append(ch)
    return ''.join(result)

def groq_call(messages, max_tokens=1500, temperature=0.3):
    headers = {"Authorization":"Bearer "+GROQ_API_KEY,"Content-Type":"application/json"}
    for model in [GROQ_MODEL, GROQ_MODEL_BACKUP]:
        payload = {"model":model,"messages":messages,"temperature":temperature,"max_tokens":max_tokens}
        for attempt in range(2):
            r = requests.post(GROQ_URL,headers=headers,json=payload,timeout=45)
            if r.status_code == 429:
                time.sleep(8)
                continue
            if r.status_code == 200:
                text = r.json()["choices"][0]["message"]["content"]
                if text and text.strip():
                    return text
            break  # non-429 error, try next model
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]

def build_analysis_prompt(resume_text, jd_text):
    jd_line    = "JOB DESCRIPTION:\n"+jd_text[:1500] if jd_text else "No job description provided."
    jd_mention = " against the provided job description" if jd_text else ""
    return (
        "You are an expert resume and ATS analyzer. Analyze the resume below"+jd_mention+".\n"
        "CRITICAL: Return ONLY valid JSON. No markdown, no backticks. Use | as bullet separator.\n\n"
        '{"overall_score":<0-100>,"jd_match_score":<0-100 or null>,'
        '"summary":"<2-3 sentence summary>",'
        '"strengths":"<point1 | point2 | point3>",'
        '"weaknesses":"<point1 | point2 | point3>",'
        '"suggestions":"<1. tip | 2. tip | 3. tip>",'
        '"jd_feedback":"<JD feedback or null>",'
        '"ats_keywords":["kw1","kw2","kw3","kw4","kw5","kw6","kw7","kw8"],'
        '"ats_score":<0-100>,'
        '"ats_checks":{"has_contact_info":<true or false>,"has_work_experience":<true or false>,'
        '"has_education":<true or false>,"has_skills_section":<true or false>,'
        '"has_measurable_achievements":<true or false>,"no_tables_or_graphics":<true or false>,'
        '"proper_date_format":<true or false>,"good_keyword_density":<true or false>},'
        '"ats_tips":"<tip1 | tip2 | tip3>",'
        '"job_matches":[{"role":"Title","score":85,"reason":"one line"},{"role":"Title","score":80,"reason":"one line"},{"role":"Title","score":75,"reason":"one line"},{"role":"Title","score":70,"reason":"one line"},{"role":"Title","score":65,"reason":"one line"}]}\n\n'
        "RESUME:\n"+resume_text[:1500]+"\n\n"+jd_line
    )

@app.route('/login')
def login():
    if session.get('user'): return redirect(url_for('index'))
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.clear()
    response = redirect(url_for('login'))
    response.delete_cookie('session')
    return response

@app.route('/auth/session',methods=['POST'])
def auth_session():
    try:
        data = request.get_json(force=True, silent=True)
        if not data:
            return jsonify({'error':'No data received'}), 400
        uid = data.get('uid','').strip()
        if not uid:
            return jsonify({'error':'No user ID'}), 400
        name  = data.get('name','')
        email = data.get('email','')
        photo = data.get('photo','')
        # Save to DB (non-fatal if fails)
        try:
            init_db()
            upsert_user(uid, name, email, photo, 'firebase')
        except Exception as db_err:
            print(f"DB warning: {db_err}")
        # Set Flask session
        session.clear()
        session['user'] = {
            'uid':   uid,
            'name':  name,
            'email': email,
            'photo': photo,
            'is_guest': False
        }
        session.modified = True
        session.permanent = True
        print(f"Session set for user: {email or uid}")
        return jsonify({'ok': True})
    except Exception as e:
        import traceback
        print(f"Auth session error: {traceback.format_exc()}")
        return jsonify({'error': str(e)}), 500

@app.route('/auth/guest',methods=['POST'])
def auth_guest():
    session['user'] = {'uid':'guest_'+str(uuid.uuid4())[:8],'name':'Guest','email':'','photo':'','is_guest':True}
    session.permanent = True
    return jsonify({'ok':True})

@app.route('/auth/me')
def auth_me():
    user = session.get('user')
    if not user: return jsonify({'logged_in': False, 'is_guest': False})
    return jsonify({'logged_in': True, **user})

@app.route('/')
@login_required
def index(): return render_template('index.html')

@app.route('/history-page')
@login_required
def history_page(): return render_template('history.html')

@app.route('/compare-page')
@login_required
def compare_page(): return render_template('compare.html')

@app.route('/analyze',methods=['POST'])
def analyze():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Please sign in to analyze your resume.'}), 401
    if 'resume' not in request.files: return jsonify({'error':'No file uploaded.'}),400
    file = request.files['resume']
    jd_text = request.form.get('jd','').strip()
    if not file.filename.lower().endswith('.pdf'): return jsonify({'error':'Please upload a PDF file only.'}),400
    os.makedirs(app.config['UPLOAD_FOLDER'],exist_ok=True)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'],file.filename)
    file.save(filepath)
    resume_text = extract_text(filepath)
    if not resume_text or len(resume_text)<50:
        return jsonify({'error':'Could not read text from your PDF. Make sure it is not a scanned image.'}),400
    try:
        raw    = groq_call([{"role":"user","content":build_analysis_prompt(resume_text,jd_text)}])
        result = json.loads(clean_json(raw))
    except Exception as e: return jsonify({'error':friendly_error(e)}),500
    for key in ['strengths','weaknesses','suggestions','ats_tips']:
        if key in result and result[key]:
            result[key] = result[key].replace(' | ','|').replace('| ','|')
    sid = str(uuid.uuid4())
    chat_store[sid] = {"resume_text":resume_text,"analysis":result,"messages":[]}
    result['session_id'] = sid
    result['resume_text'] = resume_text
    if not is_guest():
        best_match = result.get('job_matches',[{}])[0].get('role','N/A')
        save_result(user['uid'],file.filename,result.get('overall_score',0),
                    str(result.get('jd_match_score','N/A')),result.get('ats_score',0),
                    best_match,result.get('summary',''))
    result['is_guest'] = is_guest()
    return jsonify(result)

@app.route('/roadmap',methods=['POST'])
def roadmap():
    if not get_current_user(): return jsonify({'error':'Please sign in first.'}),401
    data = request.get_json()
    prompt = (
        "You are a career coach. Create a detailed skill learning roadmap.\n"
        "CRITICAL: Return ONLY valid JSON. No markdown, no backticks.\n\n"
        '{"target_role":"'+data.get('target_role','Developer')+'","total_duration":"<e.g. 3 months>",'
        '"roadmap":[{"step":1,"skill":"Skill","duration":"2 weeks","level":"Beginner","why":"reason","resources":["Resource 1","Resource 2"]}],'
        '"quick_wins":["action1","action2"],"final_tip":"motivational tip"}\n\n'
        "RESUME: "+data.get('resume_text','')[:1500]+"\n"
        "MISSING SKILLS: "+", ".join(data.get('missing_skills',[]))+"\n"
        "TARGET ROLE: "+data.get('target_role','Developer')
    )
    try:
        raw    = groq_call([{"role":"user","content":prompt}],max_tokens=1000)
        result = json.loads(clean_json(raw))
    except Exception as e: return jsonify({'error':friendly_error(e)}),500
    return jsonify(result)

@app.route('/chat',methods=['POST'])
def chat():
    if not get_current_user(): return jsonify({'error':'Please sign in first.'}),401
    data = request.get_json()
    sid  = data.get('session_id','')
    msg  = data.get('message','').strip()
    if not sid or sid not in chat_store: return jsonify({'error':'Session expired. Please re-analyze your resume.'}),400
    ctx = chat_store[sid]
    system_prompt = (
        "You are a helpful career coach assistant.\nRESUME:\n"+ctx['resume_text'][:1000]+"\n\n"
        "ANALYSIS: Overall: "+str(ctx['analysis'].get('overall_score','N/A'))+
        "/100, ATS: "+str(ctx['analysis'].get('ats_score','N/A'))+"/100"
    )
    ctx['messages'].append({"role":"user","content":msg})
    try: reply = groq_call([{"role":"system","content":system_prompt}]+ctx['messages'][-10:],max_tokens=600,temperature=0.5)
    except Exception as e: return jsonify({'error':friendly_error(e)}),500
    ctx['messages'].append({"role":"assistant","content":reply})
    return jsonify({'reply':reply})

@app.route('/rewrite',methods=['POST'])
def rewrite():
    if not get_current_user(): return jsonify({'error':'Please sign in first.'}),401
    data = request.get_json()
    prompt = (
        "You are an expert resume writer. Rewrite resume bullets to be stronger and ATS-optimized.\n"
        "CRITICAL: Return ONLY valid JSON. No markdown, no backticks.\n\n"
        '{"rewritten_bullets":[{"original":"bullet","rewritten":"improved bullet"}],'
        '"overall_improvements":"summary","power_words":["w1","w2","w3","w4","w5"]}\n\n'
        "RESUME:\n"+data.get('resume_text','')[:2500]+
        ("\nJD:\n"+data.get('jd_text','')[:1000] if data.get('jd_text') else "")
    )
    try:
        raw    = groq_call([{"role":"user","content":prompt}],max_tokens=1000)
        result = json.loads(clean_json(raw))
    except Exception as e: return jsonify({'error':friendly_error(e)}),500
    return jsonify(result)

@app.route('/interview',methods=['POST'])
def interview():
    if not get_current_user(): return jsonify({'error':'Please sign in first.'}),401
    data = request.get_json()
    role = data.get('role','Software Developer')
    prompt = (
        "Generate 12 interview questions for this resume and role.\n"
        "CRITICAL: Return ONLY valid JSON. No markdown, no backticks.\n\n"
        '{"role":"'+role+'","questions":[{"category":"Technical","question":"text","tip":"how to answer","difficulty":"Easy"}]}\n\n'
        "RESUME:\n"+data.get('resume_text','')[:2000]+"\nROLE: "+role
    )
    try:
        raw    = groq_call([{"role":"user","content":prompt}],max_tokens=1000)
        result = json.loads(clean_json(raw))
    except Exception as e: return jsonify({'error':friendly_error(e)}),500
    return jsonify(result)

@app.route('/coverletter',methods=['POST'])
@login_required
def coverletter():
    data    = request.get_json()
    company = data.get('company','the company')
    role    = data.get('role','the role')
    prompt = (
        "Write a professional personalized cover letter.\n"
        "CRITICAL: Return ONLY valid JSON. No markdown, no backticks.\n\n"
        '{"subject":"Cover Letter - '+role+' at '+company+'",'
        '"cover_letter":"<full letter with \\n for line breaks>",'
        '"key_highlights":["h1","h2","h3"]}\n\n'
        "RESUME:\n"+data.get('resume_text','')[:2000]+"\n"
        "JOB DESC:\n"+(data.get('jd_text','')[:1000] or "Not provided")+"\n"
        "COMPANY: "+company+"\nROLE: "+role
    )
    try:
        raw    = groq_call([{"role":"user","content":prompt}],max_tokens=1000,temperature=0.5)
        result = json.loads(clean_json(raw))
    except Exception as e: return jsonify({'error':friendly_error(e)}),500
    return jsonify(result)

@app.route('/compare',methods=['POST'])
def compare():
    if not get_current_user(): return jsonify({'error':'Please sign in first.'}),401
    files = request.files.getlist('resumes')
    if len(files)<2: return jsonify({'error':'Please upload at least 2 PDF resumes.'}),400
    if len(files)>4: return jsonify({'error':'Maximum 4 resumes allowed.'}),400
    resumes=[]
    for f in files:
        if not f.filename.lower().endswith('.pdf'): return jsonify({'error':'All files must be PDFs.'}),400
        os.makedirs(app.config['UPLOAD_FOLDER'],exist_ok=True)
        fp=os.path.join(app.config['UPLOAD_FOLDER'],f.filename); f.save(fp)
        resumes.append({"name":f.filename,"text":extract_text(fp)[:1500]})
    prompt=(
        "Compare these resumes and rank them.\n"
        "CRITICAL: Return ONLY valid JSON. No markdown, no backticks.\n\n"
        '{"comparison":[{"rank":1,"name":"file","overall_score":85,"ats_score":80,"strengths":"s","weaknesses":"w","verdict":"v"}],'
        '"winner":"file","winner_reason":"reason","common_gaps":"gaps"}\n\n'
        +"\n\n".join([f"RESUME {i+1} ({r['name']}):\n{r['text']}" for i,r in enumerate(resumes)])
    )
    try:
        raw    = groq_call([{"role":"user","content":prompt}],max_tokens=1000)
        result = json.loads(clean_json(raw))
    except Exception as e: return jsonify({'error':friendly_error(e)}),500
    return jsonify(result)

@app.route('/history')
def history():
    user = get_current_user()
    if not user:
        return jsonify([])  # Return empty array instead of redirecting
    if is_guest():
        return jsonify([])  # Guests have no history
    return jsonify(get_history(user['uid']))

if __name__ == '__main__':
    os.makedirs('uploads',exist_ok=True)
    init_db()
    print("\n✅ ResumeAI running!")
    print("🌐 Open: http://127.0.0.1:5000\n")
    app.run(debug=True)
