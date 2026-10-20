"use client";
import { shanghaiDate } from "@/lib/health/reducer";
import { useEffect, useRef, useState } from "react";
import {
  Camera,
  Plus,
  MapPin,
  Heart,
  Star,
  ChevronRight,
  Utensils,
  Leaf,
  Check,
} from "lucide-react";
import { Dialog } from "@/components/dialog";
import { useHealth } from "@/components/health-provider";
import { demoRecognize } from "@/lib/health/services";
import { restaurants } from "@/lib/health/seed";
import type { MealType, FoodDraft } from "@/lib/health/types";
export function Nutrition() {
  const { state, dispatch, today, ready } = useHealth();
  const [meal, setMeal] = useState<MealType>("午餐");
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState("");
  const [decoded, setDecoded] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<FoodDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("全部");
  const [detail, setDetail] = useState<(typeof restaurants)[number] | null>(
    null,
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const list = state.meals.filter((x) => x.date === today && x.meal === meal);
  const allCalories = state.meals
    .filter((x) => x.date === today)
    .reduce((n, x) => n + x.calories, 0);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("photo")) setOpen(true);
  }, []);
  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo);
    },
    [photo],
  );
  function close() {
    requestRef.current++;
    setOpen(false);
    setPhoto("");
    setDecoded(false);
    setDraft(null);
    setError("");
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  }
  async function recognize() {
    const id = ++requestRef.current;
    setBusy(true);
    const result = await demoRecognize();
    if (id === requestRef.current) {
      setDraft(result[0]);
      setBusy(false);
    }
  }
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="greeting">
            <Leaf size={15} />
            让每一餐，都成为身体喜欢的样子
          </p>
          <h1>好好吃饭，慢慢变好。</h1>
          <p className="muted">不用对美食说不，找到属于你的均衡。</p>
        </div>
        <button
          className="outline-button desktop-only"
          onClick={() => {
            setOpen(true);
            setDraft({ name: "", grams: 200, calories: 300 });
          }}
        >
          <Plus size={16} />
          手动记录
        </button>
      </section>
      <section className="feature-banner">
        <div>
          <span className="tag white">饮食拍照记录</span>
          <h2>
            美味不用算，
            <br />
            拍一下就记住。
          </h2>
          <p>拍下你的这一餐，轻松了解食物与营养。</p>
          <button
            className="primary-button"
            disabled={!ready}
            onClick={() => setOpen(true)}
          >
            <Camera size={18} />
            拍照记录
          </button>
        </div>
        <img src="/buddy.svg" alt="小养陪你记录饮食" />
      </section>
      <div className="two-column">
        <section>
          <div className="section-title">
            <div>
              <h2>今天，吃了些什么？</h2>
              <p>摄入 {allCalories} 千卡 / 目标 1,800 千卡</p>
            </div>
            <button
              className="icon-button"
              aria-label="手动添加食物"
              onClick={() => {
                setOpen(true);
                setDraft({ name: "", grams: 200, calories: 300 });
              }}
            >
              <Plus size={18} />
            </button>
          </div>
          <div className="tabs" aria-label="餐次">
            {(["早餐", "午餐", "晚餐", "加餐"] as MealType[]).map((m) => (
              <button
                key={m}
                className={meal === m ? "active" : ""}
                aria-pressed={meal === m}
                onClick={() => setMeal(m)}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="list">
            {list.length ? (
              list.map((x) => (
                <div className="list-row" key={x.id}>
                  <span className="row-icon">
                    {meal === "早餐" ? "🥑" : meal === "加餐" ? "🍎" : "🥗"}
                  </span>
                  <div>
                    <h3>{x.name}</h3>
                    <p>
                      {x.grams} g · {x.meal}
                    </p>
                  </div>
                  <div className="row-end">
                    {x.calories}
                    <small>千卡</small>
                  </div>
                </div>
              ))
            ) : (
              <div className="empty">
                这一餐还没有记录
                <br />
                <button className="text-link" onClick={() => setOpen(true)}>
                  记录你的美味时刻 <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
          <p className="subsection-note">
            热量与营养值为演示估算，可在记录时修改。
          </p>
        </section>
        <section className="card">
          <div className="section-head">
            <h2>
              <Utensils size={17} />
              今日饮食小灵感
            </h2>
            <span className="tag mint">均衡一餐</span>
          </div>
          <img
            src="/salad.svg"
            alt="均衡沙拉餐插画"
            style={{ borderRadius: 14, margin: "17px 0" }}
          />
          <h3>给餐盘，多一点颜色</h3>
          <p className="muted tiny" style={{ marginTop: 7, lineHeight: 1.9 }}>
            蔬菜、蛋白质和主食都留一个位置。吃饭时放慢一点，感受身体的饥饱信号。
          </p>
        </section>
      </div>
      <section id="nearby" className="section-space">
        <div className="section-title">
          <div>
            <h2>附近，也有好食光</h2>
            <p>
              <MapPin size={12} style={{ verticalAlign: "middle" }} /> 演示商家
              · 距离与评分为示例
            </p>
          </div>
        </div>
        <div className="tabs">
          {["全部", "高蛋白", "均衡膳食", "轻盈早餐"].map((x) => (
            <button
              key={x}
              className={filter === x ? "active" : ""}
              aria-pressed={filter === x}
              onClick={() => setFilter(x)}
            >
              {x}
            </button>
          ))}
        </div>
        <div className="restaurant-grid">
          {restaurants
            .filter((x) => filter === "全部" || x.tag === filter)
            .map((x) => (
              <article key={x.id} className="card restaurant-card">
                <div className="restaurant-art">
                  {x.id === "green" ? (
                    <img src="/salad.svg" alt="轻食沙拉插画" />
                  ) : (
                    <span className="food-emoji">{x.emoji}</span>
                  )}
                  <span className="tag">{x.tag}</span>
                </div>
                <div className="restaurant-content">
                  <h3>{x.name}</h3>
                  <div className="restaurant-meta">
                    <span className="rating">★ {x.rating}</span>
                    <span>{x.distance}</span>
                    <span>{x.calories} 千卡起</span>
                  </div>
                  <p className="muted tiny">{x.desc}</p>
                  <div className="row-actions">
                    <strong>
                      ¥{x.price}
                      <small> / 人</small>
                    </strong>
                    <button
                      className="outline-button"
                      aria-label={"查看" + x.name}
                      onClick={() => setDetail(x)}
                    >
                      看看这家
                      <ChevronRight size={13} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
        </div>
      </section>
      <footer className="page-footer">
        吃得开心，也吃得安心。<span>拍照识别与商家推荐均为演示</span>
      </footer>
      <Dialog open={open} onClose={close} title="记录这一餐">
        <p className="muted">
          照片只在本机预览。当前为模拟识别，结果需自行确认。
        </p>
        {!draft && (
          <>
            <div className="photo-zone">
              {photo ? (
                <img
                  className="photo-preview"
                  src={photo}
                  alt="待记录的食物照片"
                  onLoad={() => setDecoded(true)}
                  onError={() => {
                    requestRef.current++;
                    setBusy(false);
                    setDecoded(false);
                    setPhoto("");
                    setError(
                      "无法读取这张图片，请重新选择 JPG、PNG 或 WebP 图片。",
                    );
                  }}
                />
              ) : (
                <Camera size={30} />
              )}
              <label>
                选择或拍摄食物照片
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic"
                  capture="environment"
                  onChange={(e) => {
                    requestRef.current++;
                    setBusy(false);
                    const f = e.target.files?.[0];
                    setError("");
                    setDraft(null);
                    setPhoto("");
                    setDecoded(false);
                    if (!f) return;
                    if (
                      !/^image\/(jpeg|png|webp|heic)$/.test(f.type) ||
                      f.size > 10 * 1024 * 1024
                    ) {
                      setError(
                        "请选择 10MB 以内的 JPG、PNG、WebP 或 HEIC 图片。",
                      );
                      return;
                    }
                    setPhoto(URL.createObjectURL(f));
                  }}
                />
              </label>
            </div>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button
              className="primary-button full-width"
              disabled={!photo || !decoded || busy}
              onClick={recognize}
            >
              {busy ? "正在生成演示结果…" : "演示识别"}
            </button>
            <button
              className="text-link"
              style={{ marginTop: 13 }}
              onClick={() => setDraft({ name: "", grams: 200, calories: 300 })}
            >
              也可以手动输入
            </button>
          </>
        )}
        {draft && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              dispatch({
                type: "meal",
                meal: {
                  ...draft,
                  name: draft.name.trim(),
                  date: shanghaiDate(),
                  meal,
                  id: crypto.randomUUID(),
                },
              });
              close();
            }}
          >
            <span className="tag lilac">演示识别结果 · 请核对后保存</span>
            <label>
              食物名称
              <input
                required
                maxLength={100}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <div className="inline-form">
              <label>
                份量（g）
                <input
                  required
                  type="number"
                  min="1"
                  max="5000"
                  value={draft.grams}
                  onChange={(e) =>
                    setDraft({ ...draft, grams: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                热量（千卡）
                <input
                  required
                  type="number"
                  min="1"
                  max="5000"
                  value={draft.calories}
                  onChange={(e) =>
                    setDraft({ ...draft, calories: Number(e.target.value) })
                  }
                />
              </label>
            </div>
            <label>
              餐次
              <select
                value={meal}
                onChange={(e) => setMeal(e.target.value as MealType)}
              >
                {["早餐", "午餐", "晚餐", "加餐"].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <button
              disabled={!ready || !draft.name.trim()}
              className="primary-button"
            >
              <Check size={16} />
              确认记录
            </button>
          </form>
        )}
      </Dialog>
      <Dialog
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.name ?? "餐厅详情"}
      >
        {detail && (
          <>
            <div className="detail-emoji">{detail.emoji}</div>
            <p>{detail.desc}</p>
            <div className="note-block">
              演示商家，距离 {detail.distance}、评分 {detail.rating} 和人均 ¥
              {detail.price} 均为示例。尚未接入地图或真实商家服务。
            </div>
            <button
              className="primary-button full-width"
              disabled={!ready}
              onClick={() => dispatch({ type: "favorite", id: detail.id })}
            >
              <Heart
                size={16}
                fill={
                  state.favorites.includes(detail.id) ? "currentColor" : "none"
                }
              />
              {state.favorites.includes(detail.id)
                ? "已收藏 · 点击取消"
                : "收藏这家"}
            </button>
          </>
        )}
      </Dialog>
    </>
  );
}
