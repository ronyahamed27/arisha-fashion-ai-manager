require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const rateLimit = require("express-rate-limit");
const cron = require("node-cron");

const app = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("localhost") ? { rejectUnauthorized: false } : false });
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));
app.use("/api/auth/login", rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }));

async function db(sql, params=[]) { return (await pool.query(sql, params)).rows; }
async function initDb() {
  await db(`CREATE TABLE IF NOT EXISTS products(
    id SERIAL PRIMARY KEY, sku TEXT UNIQUE, name TEXT NOT NULL, description TEXT DEFAULT '',
    price NUMERIC(12,2) NOT NULL DEFAULT 0, stock INTEGER NOT NULL DEFAULT 0,
    image_url TEXT DEFAULT '', active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW())`);
  await db(`CREATE TABLE IF NOT EXISTS customers(
    id SERIAL PRIMARY KEY, name TEXT DEFAULT '', phone TEXT, address TEXT DEFAULT '',
    messenger_id TEXT UNIQUE, created_at TIMESTAMPTZ DEFAULT NOW())`);
  await db(`CREATE TABLE IF NOT EXISTS orders(
    id SERIAL PRIMARY KEY, customer_id INTEGER REFERENCES customers(id),
    customer_name TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL,
    items JSONB NOT NULL DEFAULT '[]', subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
    delivery_charge NUMERIC(12,2) NOT NULL DEFAULT 0, total NUMERIC(12,2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending', courier_status TEXT DEFAULT 'not_booked',
    steadfast_consignment_id TEXT, booking_approved_at TIMESTAMPTZ,
    notes TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW())`);
  await db(`CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  await db(`CREATE TABLE IF NOT EXISTS conversations(
    id SERIAL PRIMARY KEY, sender_id TEXT NOT NULL, message TEXT NOT NULL,
    reply TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW())`);
}
function auth(req,res,next) {
  const token=(req.headers.authorization||"").replace(/^Bearer /,"");
  try { req.user=jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({error:"অনুগ্রহ করে আবার লগইন করুন"}); }
}
const admin=(req,res,next)=>auth(req,res,next);
const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);

app.get("/health",(req,res)=>res.json({ok:true,service:"Aarisha Fashion AI",version:"2.0.0"}));
app.post("/api/auth/login", asyncRoute(async(req,res)=>{
  const {username,password}=req.body||{};
  if(!process.env.JWT_SECRET || !process.env.ADMIN_PASSWORD) return res.status(503).json({error:"সার্ভারের ADMIN_PASSWORD ও JWT_SECRET সেট করা হয়নি"});
  const validUser=username=== (process.env.ADMIN_USERNAME||"admin");
  const stored=process.env.ADMIN_PASSWORD;
  const validPass=stored.startsWith("$2") ? await bcrypt.compare(password||"",stored) : password===stored;
  if(!validUser||!validPass) return res.status(401).json({error:"ইউজারনেম অথবা পাসওয়ার্ড ভুল"});
  res.json({token:jwt.sign({role:"admin",username},process.env.JWT_SECRET,{expiresIn:"12h"})});
}));
app.get("/api/dashboard",admin,asyncRoute(async(req,res)=>{
  const [p,o,sales,low]=await Promise.all([
    db("SELECT COUNT(*)::int count FROM products WHERE active=true"),
    db("SELECT COUNT(*)::int count FROM orders WHERE status NOT IN ('delivered','cancelled')"),
    db("SELECT COALESCE(SUM(total),0) total FROM orders WHERE status='delivered' AND created_at::date=CURRENT_DATE"),
    db("SELECT COUNT(*)::int count FROM products WHERE active=true AND stock<=5")
  ]);
  res.json({products:p[0].count,activeOrders:o[0].count,todaySales:Number(sales[0].total),lowStock:low[0].count});
}));
app.get("/api/products",admin,asyncRoute(async(req,res)=>res.json(await db("SELECT * FROM products ORDER BY id DESC"))));
app.post("/api/products",admin,asyncRoute(async(req,res)=>{
  const {sku,name,description="",price=0,stock=0,image_url=""}=req.body||{};
  if(!name || Number(price)<0 || !Number.isInteger(Number(stock)) || Number(stock)<0) return res.status(400).json({error:"পণ্যের নাম, সঠিক দাম ও স্টক দিন"});
  const rows=await db("INSERT INTO products(sku,name,description,price,stock,image_url) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",[sku||null,name,description,price,stock,image_url]);
  res.status(201).json(rows[0]);
}));
app.put("/api/products/:id",admin,asyncRoute(async(req,res)=>{
  const {sku,name,description="",price=0,stock=0,image_url="",active=true}=req.body||{};
  const rows=await db("UPDATE products SET sku=$1,name=$2,description=$3,price=$4,stock=$5,image_url=$6,active=$7 WHERE id=$8 RETURNING *",[sku||null,name,description,price,stock,image_url,active,req.params.id]);
  if(!rows.length)return res.status(404).json({error:"পণ্য পাওয়া যায়নি"}); res.json(rows[0]);
}));
app.delete("/api/products/:id",admin,asyncRoute(async(req,res)=>{
  await db("UPDATE products SET active=false WHERE id=$1",[req.params.id]); res.json({ok:true});
}));
app.get("/api/orders",admin,asyncRoute(async(req,res)=>res.json(await db("SELECT * FROM orders ORDER BY id DESC LIMIT 500"))));
app.post("/api/orders",admin,asyncRoute(async(req,res)=>{
  const {customer_name,phone,address,items=[],delivery_charge=0,notes=""}=req.body||{};
  if(!customer_name||!phone||!address||!Array.isArray(items)||!items.length) return res.status(400).json({error:"কাস্টমার, ফোন, ঠিকানা ও পণ্য আবশ্যক"});
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    let subtotal=0, normalized=[];
    for(const item of items){
      const r=await client.query("SELECT * FROM products WHERE id=$1 AND active=true FOR UPDATE",[item.product_id]);
      if(!r.rows.length) throw new Error("একটি পণ্য পাওয়া যায়নি");
      const p=r.rows[0], qty=Number(item.quantity);
      if(!Number.isInteger(qty)||qty<1||p.stock<qty) throw new Error(`${p.name}: পর্যাপ্ত স্টক নেই`);
      subtotal+=Number(p.price)*qty;
      normalized.push({product_id:p.id,name:p.name,quantity:qty,unit_price:Number(p.price)});
      await client.query("UPDATE products SET stock=stock-$1 WHERE id=$2",[qty,p.id]);
    }
    const total=subtotal+Number(delivery_charge||0);
    const result=await client.query(`INSERT INTO orders(customer_name,phone,address,items,subtotal,delivery_charge,total,notes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[customer_name,phone,address,JSON.stringify(normalized),subtotal,delivery_charge,total,notes]);
    await client.query("COMMIT"); res.status(201).json(result.rows[0]);
  } catch(e){await client.query("ROLLBACK"); throw e;} finally{client.release();}
}));
app.patch("/api/orders/:id/status",admin,asyncRoute(async(req,res)=>{
  const allowed=["pending","confirmed","processing","shipped","delivered","cancelled"];
  if(!allowed.includes(req.body.status))return res.status(400).json({error:"অবৈধ অর্ডার স্ট্যাটাস"});
  const rows=await db("UPDATE orders SET status=$1 WHERE id=$2 RETURNING *",[req.body.status,req.params.id]);
  if(!rows.length)return res.status(404).json({error:"অর্ডার পাওয়া যায়নি"}); res.json(rows[0]);
}));
app.post("/api/orders/:id/approve-courier",admin,asyncRoute(async(req,res)=>{
  const rows=await db("SELECT * FROM orders WHERE id=$1",[req.params.id]);
  if(!rows.length)return res.status(404).json({error:"অর্ডার পাওয়া যায়নি"});
  const order=rows[0];
  if(order.courier_status==="booked")return res.status(409).json({error:"এই অর্ডারের কুরিয়ার বুকিং আগে হয়েছে"});
  if(req.body.confirmation!=="APPROVE_STEADFAST_BOOKING") return res.status(400).json({error:"স্পষ্ট অনুমোদন প্রয়োজন"});
  if(!process.env.STEADFAST_API_KEY||!process.env.STEADFAST_SECRET_KEY) return res.status(503).json({error:"Steadfast API credentials সেট করা হয়নি"});
  const payload={invoice:`AF-${order.id}`,recipient_name:order.customer_name,recipient_phone:order.phone,
    recipient_address:order.address,cod_amount:Number(order.total),note:order.notes||""};
  const response=await fetch(`${(process.env.STEADFAST_BASE_URL||"https://portal.steadfast.com.bd/api/v1").replace(/\/$/,"")}/create_order`,{
    method:"POST",headers:{"Content-Type":"application/json","Api-Key":process.env.STEADFAST_API_KEY,"Secret-Key":process.env.STEADFAST_SECRET_KEY},body:JSON.stringify(payload)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.status!=="success")return res.status(502).json({error:"Steadfast বুকিং ব্যর্থ হয়েছে",details:data});
  const consignment=data.consignment||data;
  const updated=await db("UPDATE orders SET courier_status='booked',steadfast_consignment_id=$1,booking_approved_at=NOW(),status='shipped' WHERE id=$2 RETURNING *",[String(consignment.consignment_id||consignment.id||""),order.id]);
  res.json({order:updated[0],courier:data});
}));
app.get("/api/reports/daily",admin,asyncRoute(async(req,res)=>{
  const rows=await db(`SELECT COUNT(*)::int orders, COUNT(*) FILTER(WHERE status='delivered')::int delivered,
    COUNT(*) FILTER(WHERE status='cancelled')::int cancelled,
    COALESCE(SUM(total) FILTER(WHERE status='delivered'),0) sales
    FROM orders WHERE created_at::date=COALESCE($1::date,CURRENT_DATE)`,[req.query.date||null]);
  res.json(rows[0]);
}));
app.get("/api/settings",admin,asyncRoute(async(req,res)=>{
  const rows=await db("SELECT key,value FROM settings ORDER BY key"); res.json(rows);
}));
app.put("/api/settings/:key",admin,asyncRoute(async(req,res)=>{
  const allowed=["business_name","delivery_inside_dhaka","delivery_outside_dhaka","ai_business_instructions"];
  if(!allowed.includes(req.params.key))return res.status(400).json({error:"এই সেটিং পরিবর্তন করা যাবে না"});
  const row=await db("INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value RETURNING *",[req.params.key,String(req.body.value||"")]); res.json(row[0]);
}));

async function sendMessenger(psid,text){
  const url=`https://graph.facebook.com/${process.env.META_GRAPH_VERSION||"v22.0"}/me/messages?access_token=${process.env.META_PAGE_ACCESS_TOKEN}`;
  const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({recipient:{id:psid},message:{text}})});
  if(!r.ok)throw new Error("Messenger send failed: "+await r.text());
}
async function aiReply(message){
  const products=await db("SELECT name,description,price,stock FROM products WHERE active=true ORDER BY id DESC LIMIT 100");
  const instructions=(await db("SELECT value FROM settings WHERE key='ai_business_instructions'"))[0]?.value||"আপনি Aarisha Fashion-এর ভদ্র বাংলা কাস্টমার কেয়ার সহকারী। অজানা তথ্য বানাবেন না।";
  if(!process.env.OPENAI_API_KEY)return "ধন্যবাদ! আপনার বার্তাটি পেয়েছি। আমাদের টিম শিগগিরই বিস্তারিত জানাবে।";
  const prompt=`${instructions}\nপণ্যের তালিকা:\n${JSON.stringify(products)}\nনিয়ম: স্টক শূন্য হলে পাওয়া যাবে বলবেন না। অর্ডার নিশ্চিত/কুরিয়ার বুকিং হয়েছে বলবেন না। কুরিয়ার বুকিংয়ের আগে মালিকের অনুমোদন বাধ্যতামূলক।\nকাস্টমারের বার্তা: ${message}`;
  const r=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({model:process.env.OPENAI_MODEL||"gpt-4.1-mini",input:prompt})});
  const d=await r.json(); if(!r.ok)throw new Error(d.error?.message||"OpenAI error");
  return (d.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==="output_text").map(x=>x.text).join("\n").slice(0,1800)||"ধন্যবাদ! আমাদের টিম শিগগিরই উত্তর দেবে।";
}
app.get("/webhook",(req,res)=>{
  const ok=req.query["hub.mode"]==="subscribe"&&req.query["hub.verify_token"]===process.env.META_VERIFY_TOKEN;
  res.status(ok?200:403).send(ok?req.query["hub.challenge"]:"Verification failed");
});
app.post("/webhook",asyncRoute(async(req,res)=>{
  // Meta signature যাচাই: production-এ META_APP_SECRET অবশ্যই দিন
  if(process.env.META_APP_SECRET){
    const sig=req.headers["x-hub-signature-256"]||"";
    const expected="sha256="+crypto.createHmac("sha256",process.env.META_APP_SECRET).update(JSON.stringify(req.body)).digest("hex");
    if(!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return res.sendStatus(401);
  }
  res.sendStatus(200);
  for(const entry of req.body.entry||[]) for(const event of entry.messaging||[]){
    const psid=event.sender?.id, message=event.message?.text;
    if(!psid||!message||event.message?.is_echo)continue;
    try{
      const reply=await aiReply(message);
      await db("INSERT INTO conversations(sender_id,message,reply) VALUES($1,$2,$3)",[psid,message,reply]);
      if(process.env.META_PAGE_ACCESS_TOKEN) await sendMessenger(psid,reply);
    }catch(e){console.error("Messenger processing:",e.message);}
  }
}));
app.get("/api/conversations",admin,asyncRoute(async(req,res)=>res.json(await db("SELECT * FROM conversations ORDER BY id DESC LIMIT 200"))));

cron.schedule("5 23 * * *",async()=>{
  try{
    const r=(await db(`SELECT COUNT(*)::int orders,COALESCE(SUM(total) FILTER(WHERE status='delivered'),0) sales,
      COUNT(*) FILTER(WHERE status='delivered')::int delivered FROM orders WHERE created_at::date=CURRENT_DATE`))[0];
    console.log("Aarisha Fashion daily report",r);
  }catch(e){console.error("Daily report error",e.message);}
},{timezone:process.env.TIMEZONE||"Asia/Dhaka"});

app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:err.message||"সার্ভার সমস্যা"});});
initDb().then(()=>app.listen(PORT,()=>console.log(`Aarisha Fashion AI v2 running on ${PORT}`))).catch(e=>{console.error("Database initialization failed:",e);process.exit(1);});
