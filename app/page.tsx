"use client"

import type React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  AnimatePresence,
  motion,
  useMotionTemplate,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
  type Variants,
} from "motion/react"
import { Canvas, useFrame } from "@react-three/fiber"
import { Float, Sparkles as DreiSparkles } from "@react-three/drei"
import type { Group } from "three"
import {
  Sparkles,
  Flame,
  ArrowRight,
  ChevronDown,
  X,
  AlertCircle,
  Plus,
  Check,
  Trash2,
  LogOut,
} from "lucide-react"
import { db } from "./firebase" // Make sure the path to your firebase.ts configuration file is correct
import { doc, getDoc, setDoc } from "firebase/firestore"

/* -------------------------------------------------------------------------- */
/* Storage helpers (localStorage-backed)                                     */
/* -------------------------------------------------------------------------- */

type Habit = {
  id: string
  name: string
  completed: string[]
}

type HabitUser = {
  username: string
  userId: string
  createdAt: number
  streak: number
  habits?: Habit[]
}

const CURRENT_KEY = "habit_current_user"

function todayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10)
}

// 1. Updated Async Get User from Firebase Firestore
async function getUser(userId: string): Promise<HabitUser | null> {
  if (!userId) return null
  try {
    const userDocRef = doc(db, "habit_users", userId.trim().toLowerCase())
    const snapshot = await getDoc(userDocRef)
    if (snapshot.exists()) {
      return snapshot.data() as HabitUser
    }
    return null
  } catch (error) {
    console.error("Error fetching user from Firestore:", error)
    return null
  }
}

// 2. Updated Async Save User to Firebase Firestore
async function saveUser(user: HabitUser): Promise<void> {
  try {
    const userDocRef = doc(db, "habit_users", user.userId.trim().toLowerCase())
    await setDoc(userDocRef, user)
  } catch (error) {
    console.error("Error saving user to Firestore:", error)
    throw error
  }
}

function setCurrentUser(userId: string) {
  if (typeof window === "undefined") return
  localStorage.setItem(CURRENT_KEY, userId)
}

function clearCurrentUser() {
  if (typeof window === "undefined") return
  localStorage.removeItem(CURRENT_KEY)
}

/* -------------------------------------------------------------------------- */
/* Story sections shown inside the 3D carousel                               */
/* -------------------------------------------------------------------------- */

type StorySection = {
  id: string
  kicker?: string
  lines: string[]
  ghost?: string
}

const sections: StorySection[] = [
  {
    id: "small-habits",
    lines: [
      "One workout. One page.",
      "One glass of water. One step.",
      "Small habits don't look powerful today.",
      "They look unstoppable after 100 days.",
    ],
  },
  {
    id: "hardest-part",
    lines: ["The hardest part...", "isn't building a habit.", "It's showing up tomorrow."],
  },
  {
    id: "imagine",
    kicker: "Imagine this",
    lines: [
      "365 days from now.",
      "Your future self is looking back.",
      "Will they thank you...",
      "or wish you had started today?",
    ],
  },
  {
    id: "system",
    lines: ["You don't need motivation.", "You need a system.", "This is that system."],
  },
  {
    id: "refuse-to-quit",
    lines: ["We don't count perfect days.", "We count days you refused to quit."],
  },
  {
    id: "ready",
    lines: ["Ready?", "Let's make today count."],
  },
]

/* -------------------------------------------------------------------------- */
/* Interactive primitives                                                    */
/* -------------------------------------------------------------------------- */

function Magnetic({
  children,
  strength = 0.35,
  className,
}: {
  children: React.ReactNode
  strength?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  const handleMove = (e: React.MouseEvent) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = (e.clientX - (rect.left + rect.width / 2)) * strength
    const y = (e.clientY - (rect.top + rect.height / 2)) * strength
    setPos({ x, y })
  }

  return (
    <motion.div
      ref={ref}
      className={className}
      onMouseMove={handleMove}
      onMouseLeave={() => setPos({ x: 0, y: 0 })}
      animate={{ x: pos.x, y: pos.y }}
      transition={{ type: "spring", stiffness: 200, damping: 15, mass: 0.5 }}
    >
      {children}
    </motion.div>
  )
}

function TiltCard({
  children,
  className,
  max = 8,
}: {
  children: React.ReactNode
  className?: string
  max?: number
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const mx = useMotionValue(0.5)
  const my = useMotionValue(0.5)

  const rx = useSpring(useTransform(my, [0, 1], [max, -max]), { stiffness: 150, damping: 18 })
  const ry = useSpring(useTransform(mx, [0, 1], [-max, max]), { stiffness: 150, damping: 18 })

  const glareX = useTransform(mx, [0, 1], ["0%", "100%"])
  const glareY = useTransform(my, [0, 1], ["0%", "100%"])
  const glare = useTransform(
    [glareX, glareY],
    ([x, y]: string[]) =>
      `radial-gradient(600px circle at ${x} ${y}, rgba(255,255,255,0.12), transparent 40%)`,
  )

  const onMove = (e: React.MouseEvent) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    mx.set((e.clientX - rect.left) / rect.width)
    my.set((e.clientY - rect.top) / rect.height)
  }

  const reset = () => {
    mx.set(0.5)
    my.set(0.5)
  }

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={reset}
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 1200 }}
      className={className}
    >
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-40"
        style={{ background: glare }}
      />
      {children}
    </motion.div>
  )
}

/* -------------------------------------------------------------------------- */
/* 3D background — a scroll-reactive Three.js scene fixed behind the page    */
/* -------------------------------------------------------------------------- */

type ShapeKind = "icosahedron" | "torusKnot" | "octahedron" | "torus"

const shapes: {
  kind: ShapeKind
  position: [number, number, number]
  scale: number
  color: string
  wireframe: boolean
}[] = [
  { kind: "torusKnot", position: [-5.5, 2.5, -4], scale: 1.1, color: "#34d399", wireframe: true },
  { kind: "icosahedron", position: [5.5, -2, -3], scale: 1.5, color: "#0d9488", wireframe: true },
  { kind: "octahedron", position: [-4, -4.5, -6], scale: 1.2, color: "#34d399", wireframe: true },
  { kind: "torus", position: [4.5, 4, -7], scale: 1.4, color: "#5eead4", wireframe: true },
  { kind: "icosahedron", position: [0, -7, -5], scale: 1.8, color: "#34d399", wireframe: true },
  { kind: "octahedron", position: [7, -9, -4], scale: 1, color: "#0d9488", wireframe: true },
  { kind: "torusKnot", position: [-6.5, -11, -6], scale: 1.2, color: "#5eead4", wireframe: true },
  { kind: "torus", position: [1.5, -14, -5], scale: 1.6, color: "#34d399", wireframe: true },
]

function ShapeMesh({
  kind,
  color,
  wireframe,
}: {
  kind: ShapeKind
  color: string
  wireframe: boolean
}) {
  return (
    <mesh>
      {kind === "icosahedron" && <icosahedronGeometry args={[1, 0]} />}
      {kind === "torusKnot" && <torusKnotGeometry args={[0.7, 0.22, 96, 16]} />}
      {kind === "octahedron" && <octahedronGeometry args={[1, 0]} />}
      {kind === "torus" && <torusGeometry args={[0.9, 0.28, 16, 48]} />}
      <meshStandardMaterial
        color={color}
        wireframe={wireframe}
        emissive={color}
        emissiveIntensity={0.25}
        transparent
        opacity={0.7}
      />
    </mesh>
  )
}

function SceneContent({ progress }: { progress: MotionValue<number> }) {
  const group = useRef<Group>(null)

  useFrame((state) => {
    const g = group.current
    if (!g) return
    const p = progress.get()
    const t = state.clock.elapsedTime
    g.position.y = p * 14
    g.rotation.y = t * 0.04 + p * Math.PI * 1.2
    g.rotation.x = p * 0.5
    state.camera.position.x = Math.sin(p * Math.PI) * 1.5
    state.camera.lookAt(0, 0, 0)
  })

  return (
    <group ref={group}>
      {shapes.map((s, i) => (
        <Float key={i} speed={1.4 + (i % 3) * 0.4} rotationIntensity={0.8} floatIntensity={1.2}>
          <group position={s.position} scale={s.scale}>
            <ShapeMesh kind={s.kind} color={s.color} wireframe={s.wireframe} />
          </group>
        </Float>
      ))}
      <DreiSparkles count={160} scale={[26, 30, 16]} size={2.2} speed={0.3} color="#34d399" opacity={0.5} />
    </group>
  )
}

function Background3D() {
  const { scrollYProgress } = useScroll()
  const smooth = useSpring(scrollYProgress, { stiffness: 60, damping: 20, mass: 0.6 })

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
      <Canvas camera={{ position: [0, 0, 10], fov: 50 }} dpr={[1, 1.5]} gl={{ antialias: true }}>
        <color attach="background" args={["#040c08"]} />
        <fog attach="fog" args={["#040c08", 10, 26]} />
        <ambientLight intensity={0.35} />
        <pointLight position={[8, 6, 6]} intensity={120} color="#34d399" />
        <pointLight position={[-8, -6, 4]} intensity={80} color="#0d9488" />
        <SceneContent progress={smooth} />
      </Canvas>

      <div className="noise absolute inset-0 opacity-[0.04] mix-blend-soft-light" />
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(120% 80% at 50% 0%, transparent 40%, rgba(4,12,8,0.7) 100%)",
        }}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Navigation — exactly three buttons                                        */
/* -------------------------------------------------------------------------- */

function SiteNav({ onGetStarted }: { onGetStarted: () => void }) {
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" })
  }

  return (
    <motion.header
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-x-0 top-4 z-50 flex justify-center px-4"
    >
      <nav className="glass-strong glow-border flex w-full max-w-2xl items-center justify-between gap-4 rounded-full py-2.5 pl-4 pr-2.5">
        <span className="flex items-center gap-2 pl-1">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#34d399] to-[#0d9488]">
            <Sparkles className="h-4 w-4 text-white" />
          </span>
          <span className="hidden text-sm font-semibold tracking-tight sm:inline">Habit Tracker</span>
        </span>

        <div className="flex items-center gap-1">
          <button
            onClick={() => scrollTo("top")}
            className="rounded-full px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
          >
            Home
          </button>
          <button
            onClick={() => scrollTo("intro")}
            className="rounded-full px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
          >
            Story
          </button>
          <Magnetic strength={0.4}>
            <button
              onClick={onGetStarted}
              className="rounded-full bg-gradient-to-r from-[#34d399] to-[#0d9488] px-5 py-2.5 text-sm font-medium text-white shadow-[0_8px_30px_-8px_rgba(52,211,153,0.7)] transition-transform active:scale-95"
            >
              Get Started
            </button>
          </Magnetic>
        </div>
      </nav>
    </motion.header>
  )
}

/* -------------------------------------------------------------------------- */
/* Scroll progress rail (vertical, right side)                               */
/* -------------------------------------------------------------------------- */

function ScrollProgress() {
  const { scrollYProgress } = useScroll()
  const scaleY = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 })

  return (
    <div className="fixed right-5 top-1/2 z-40 hidden -translate-y-1/2 md:block">
      <div className="relative h-40 w-1 overflow-hidden rounded-full bg-white/10">
        <motion.div
          style={{ scaleY, originY: 0 }}
          className="absolute inset-0 rounded-full bg-gradient-to-b from-[#34d399] to-[#0d9488]"
        />
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Hero Reveal Engine                                                        */
/* -------------------------------------------------------------------------- */

const heroContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.15 } },
}
const heroItem: Variants = {
  hidden: { y: 24, opacity: 0, filter: "blur(8px)" },
  show: {
    y: 0,
    opacity: 1,
    filter: "blur(0px)",
    transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] },
  },
}

function HeroTitleWord({
  word,
  shimmer,
  baseDelay,
}: {
  word: string
  shimmer?: boolean
  baseDelay: number
}) {
  return (
    <span className="inline-flex overflow-hidden pb-2 align-bottom" style={{ perspective: "600px" }}>
      {word.split("").map((ch, i) => (
        <motion.span
          key={i}
          initial={{ y: "115%", rotateX: -85, opacity: 0 }}
          animate={{ y: "0%", rotateX: 0, opacity: 1 }}
          transition={{
            delay: baseDelay + i * 0.045,
            type: "spring",
            stiffness: 200,
            damping: 24,
          }}
          className={shimmer ? "text-shimmer inline-block" : "inline-block"}
          style={{ transformOrigin: "bottom center" }}
        >
          {ch}
        </motion.span>
      ))}
    </span>
  )
}

function HeroLine({ text, className, baseDelay }: { text: string; className?: string; baseDelay: number }) {
  return (
    <p className={className}>
      <span className="sr-only">{text}</span>
      {text.split(" ").map((word, i) => (
        <motion.span
          key={i}
          aria-hidden
          initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ delay: baseDelay + i * 0.08, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="inline-block"
        >
          {word}
          {"\u00A0"}
        </motion.span>
      ))}
    </p>
  )
}

function Hero() {
  const titleWords: { word: string; shimmer?: boolean }[] = [
    { word: "Welcome" },
    { word: "to" },
    { word: "Habit", shimmer: true },
    { word: "Tracker.", shimmer: true },
  ]
  let letterOffset = 0
  const wordDelays = titleWords.map((w) => {
    const d = 0.5 + letterOffset * 0.045
    letterOffset += w.word.length
    return d
  })

  return (
    <section
      id="top"
      className="relative z-10 flex min-h-screen flex-col items-center justify-center px-4 pt-28 pb-16"
    >
      <motion.div
        animate={{ y: [0, -10, 0] }}
        transition={{ duration: 6, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut", delay: 2.5 }}
        className="w-full max-w-4xl"
      >
        <div className="glass glass-sheen mx-auto flex flex-col items-center rounded-[2.5rem] px-6 py-14 text-center sm:px-14 sm:py-16">
          <motion.span
            variants={heroItem}
            className="glass mb-8 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground"
          >
            <motion.span
              animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
              transition={{ duration: 2, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
              className="h-1.5 w-1.5 rounded-full bg-[#34d399]"
            />
            Welcome
          </motion.span>

          <h1 className="text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl md:text-7xl">
            <span aria-hidden className="inline-flex flex-wrap justify-center gap-x-[0.26em]">
              {titleWords.map((w, i) => (
                <HeroTitleWord key={i} word={w.word} shimmer={w.shimmer} baseDelay={wordDelays[i]} />
              ))}
            </span>
          </h1>

          <HeroLine
            text="Not another productivity app."
            baseDelay={1.5}
            className="mt-8 text-balance text-xl font-medium leading-snug tracking-tight text-foreground sm:text-2xl"
          />
          <HeroLine
            text="A place where tiny actions become lifelong habits."
            baseDelay={1.9}
            className="mt-2 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground sm:text-xl"
          />

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 2.6, duration: 0.8 }}
            className="mt-14 flex flex-col items-center gap-2"
          >
            <span className="text-[0.65rem] uppercase tracking-[0.3em] text-muted-foreground/60">
              Scroll to begin
            </span>
            <motion.span
              animate={{ y: [0, 8, 0] }}
              transition={{ duration: 1.8, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
            >
              <ChevronDown className="h-5 w-5 text-[#34d399]" />
            </motion.span>
          </motion.div>
        </div>
      </motion.div>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Split intro — Text animation modules                                      */
/* -------------------------------------------------------------------------- */

function seeded(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

function BlowAwayWord({
  word,
  seed,
  progress,
  className,
}: {
  word: string
  seed: number
  progress: MotionValue<number>
  className?: string
}) {
  const dirX = seeded(seed) - 0.5
  const targetX = (dirX < 0 ? -1 : 1) * (30 + seeded(seed + 1) * 70)
  const targetY = (seeded(seed + 2) - 0.6) * 40
  const targetRot = (seeded(seed + 3) - 0.5) * 140
  const start = 0.6 + seeded(seed + 4) * 0.1

  const x = useTransform(progress, [start, 0.95], ["0vw", `${targetX}vw`])
  const y = useTransform(progress, [start, 0.95], ["0vh", `${targetY}vh`])
  const rotate = useTransform(progress, [start, 0.95], [0, targetRot])
  const opacity = useTransform(progress, [start, 0.92], [1, 0])
  const blurVal = useTransform(progress, [start, 0.95], [0, 12])
  const filter = useMotionTemplate`blur(${blurVal}px)`

  return (
    <motion.span style={{ x, y, rotate, opacity, filter }} className={`inline-block ${className ?? ""}`}>
      {word}
    </motion.span>
  )
}

function SplitIntro() {
  const ref = useRef<HTMLDivElement | null>(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  })

  const leftX = useTransform(scrollYProgress, [0.05, 0.4], ["-70vw", "0vw"])
  const rightX = useTransform(scrollYProgress, [0.05, 0.4], ["70vw", "0vw"])
  const sideOpacity = useTransform(scrollYProgress, [0.05, 0.3], [0, 1])
  const ghostScale = useTransform(scrollYProgress, [0, 0.5], [1.6, 1])
  const ghostOpacity = useTransform(scrollYProgress, [0, 0.25, 0.6, 0.9], [0, 0.07, 0.07, 0])
  const hintOpacity = useTransform(scrollYProgress, [0.4, 0.55, 0.6, 0.7], [0, 1, 1, 0])

  const line1 = "Every day starts".split(" ")
  const line2 = "with a choice.".split(" ")

  return (
    <section id="intro" ref={ref} className="relative z-10 h-[300vh]">
      <div className="sticky top-0 flex h-screen flex-col items-center justify-center overflow-hidden px-4">
        <motion.span
          aria-hidden
          style={{ scale: ghostScale, opacity: ghostOpacity }}
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none whitespace-nowrap text-[22vw] font-bold uppercase leading-none tracking-tight text-[#34d399]"
        >
          Choice
        </motion.span>

        <div className="relative flex flex-col items-center text-center">
          <motion.p
            style={{ x: leftX, opacity: sideOpacity }}
            className="flex flex-wrap justify-center gap-x-[0.3em] text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-7xl md:text-8xl"
          >
            {line1.map((w, i) => (
              <BlowAwayWord key={i} word={w} seed={i + 1} progress={scrollYProgress} />
            ))}
          </motion.p>
          <motion.p
            style={{ x: rightX, opacity: sideOpacity }}
            className="mt-2 flex flex-wrap justify-center gap-x-[0.3em] text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-7xl md:text-8xl"
          >
            {line2.map((w, i) => (
              <BlowAwayWord
                key={i}
                word={w}
                seed={i + 10}
                progress={scrollYProgress}
                className="text-gradient"
              />
            ))}
          </motion.p>
        </div>

        <motion.div
          style={{ opacity: hintOpacity }}
          className="absolute bottom-10 flex flex-col items-center gap-2"
        >
          <span className="text-[0.65rem] uppercase tracking-[0.3em] text-muted-foreground/60">
            Keep scrolling
          </span>
          <ChevronDown className="h-4 w-4 text-[#34d399]" />
        </motion.div>
      </div>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* 3D Ring Carousel Story                                                    */
/* -------------------------------------------------------------------------- */

function useCarouselRadius() {
  const [radius, setRadius] = useState(620)
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth
      setRadius(w < 640 ? 240 : w < 1024 ? 420 : 620)
    }
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])
  return radius
}

function CarouselCard({
  section,
  index,
  count,
  rotation,
  radius,
}: {
  section: StorySection
  index: number
  count: number
  rotation: MotionValue<number>
  radius: number
}) {
  const step = 360 / count

  const angle = useTransform(rotation, (r) => {
    let a = (index * step - r) % 360
    if (a > 180) a -= 360
    if (a < -180) a += 360
    return a
  })

  const transform = useMotionTemplate`translate(-50%, -50%) rotateY(${angle}deg) translateZ(${radius}px)`
  const opacity = useTransform(angle, (a) => {
    const d = Math.abs(a)
    if (d > 110) return 0
    return 1 - (d / 110) * 0.75
  })
  const frontness = useTransform(angle, (a) => Math.max(0, 1 - Math.abs(a) / step))
  const glowOpacity = useTransform(frontness, [0, 1], [0, 1])

  return (
    <motion.article
      style={{ transform, opacity, backfaceVisibility: "hidden" }}
      className="glass absolute left-1/2 top-1/2 flex h-[62vh] w-[80vw] flex-col justify-center overflow-hidden rounded-3xl p-6 text-center sm:p-10 md:h-[66vh] md:w-[560px] md:p-14"
    >
      <motion.div
        aria-hidden
        style={{ opacity: glowOpacity }}
        className="pointer-events-none absolute inset-0 rounded-[inherit]"
      >
        <div className="absolute inset-0 rounded-[inherit] shadow-[0_0_0_1px_rgba(52,211,153,0.25),0_40px_120px_-40px_rgba(52,211,153,0.5)]" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#34d399]/60 to-transparent" />
      </motion.div>

      {section.ghost && (
        <span
          aria-hidden
          className="text-gradient pointer-events-none absolute -bottom-6 left-1/2 -translate-x-1/2 select-none text-[9rem] font-bold leading-none opacity-10 md:text-[11rem]"
        >
          {section.ghost}
        </span>
      )}

      <div className="relative z-10 mx-auto flex max-w-md flex-col items-center">
        {section.kicker && (
          <span className="mb-4 text-[0.65rem] font-medium uppercase tracking-[0.3em] text-[#34d399] sm:text-xs">
            {section.kicker}
          </span>
        )}
        {section.lines.map((line, i) => (
          <p
            key={i}
            className={
              i === 0
                ? "text-balance text-2xl font-semibold leading-tight tracking-tight sm:text-3xl md:text-4xl"
                : "mt-2.5 text-balance text-base font-medium leading-snug tracking-tight text-muted-foreground sm:text-xl md:text-2xl"
            }
          >
            {line}
          </p>
        ))}
      </div>

      <span className="absolute bottom-5 right-6 text-xs tabular-nums text-muted-foreground/50">
        {String(index + 1).padStart(2, "0")}
      </span>
    </motion.article>
  )
}

function CarouselStory() {
  const ref = useRef<HTMLDivElement | null>(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  })

  const count = sections.length
  const step = 360 / count
  const radius = useCarouselRadius()

  const rawRotation = useTransform(scrollYProgress, [0, 1], [0, step * (count - 1)])
  const rotation = useSpring(rawRotation, { stiffness: 70, damping: 20, mass: 0.6 })

  const barScaleX = useTransform(scrollYProgress, [0, 1], [1 / count, 1])

  return (
    <section id="story" ref={ref} style={{ height: `${count * 100}vh` }} className="relative z-10">
      <div className="sticky top-0 flex h-screen flex-col overflow-hidden">
        <div
          className="relative flex-1"
          style={{ perspective: "1400px", perspectiveOrigin: "50% 45%" }}
        >
          <div className="absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
            {sections.map((s, i) => (
              <CarouselCard
                key={s.id}
                section={s}
                index={i}
                count={count}
                rotation={rotation}
                radius={radius}
              />
            ))}
          </div>
        </div>

        <div className="pointer-events-none absolute bottom-8 left-1/2 flex -translate-x-1/2 flex-col items-center gap-3">
          <div className="h-1 w-40 overflow-hidden rounded-full bg-white/10 sm:w-56">
            <motion.div
              style={{ scaleX: barScaleX, transformOrigin: "left" }}
              className="h-full w-full rounded-full bg-gradient-to-r from-[#34d399] to-[#0d9488]"
            />
          </div>
          <span className="text-[0.65rem] uppercase tracking-[0.3em] text-muted-foreground/60">
            Scroll to spin the ring
          </span>
        </div>
      </div>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Final screen — destination navigation cards                               */
/* -------------------------------------------------------------------------- */

function FinalScreen({ onEnterApp }: { onEnterApp: (user: HabitUser) => void }) {
  const [mode, setMode] = useState<"new" | "returning" | null>(null)

  return (
    <section
      id="final"
      className="relative z-10 flex min-h-screen items-center justify-center px-4 py-24"
    >
      <div className="w-full max-w-4xl">
        <div className="mb-12 text-center">
          <motion.p
            initial={{ opacity: 0, letterSpacing: "0.8em" }}
            whileInView={{ opacity: 1, letterSpacing: "0.3em" }}
            viewport={{ once: false, amount: 0.8 }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            className="text-xs font-medium uppercase text-[#34d399]"
          >
            Let&apos;s begin
          </motion.p>
          <AnimatedHeading
            text="Choose your journey"
            className="mt-4 text-balance text-4xl font-semibold tracking-tight sm:text-5xl"
          />
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <motion.div
            initial={{ opacity: 0, x: -60, rotateY: 20 }}
            whileInView={{ opacity: 1, x: 0, rotateY: 0 }}
            viewport={{ once: false, amount: 0.4 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            style={{ transformPerspective: 1000 }}
          >
            <TiltCard
              max={6}
              className="glass-strong glass-sheen relative flex h-full flex-col overflow-hidden rounded-3xl p-8 transition-shadow hover:glow-border"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#34d399] to-[#0d9488]">
                <Sparkles className="h-5 w-5 text-white" />
              </span>
              <h3 className="mt-6 text-2xl font-semibold tracking-tight">New user</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Start your journey. Create an identity and begin building habits that last.
              </p>
              <div className="mt-8">
                <Magnetic strength={0.3}>
                  <button
                    onClick={() => setMode("new")}
                    className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#34d399] to-[#0d9488] px-6 py-3 text-sm font-medium text-white shadow-[0_10px_40px_-10px_rgba(13,148,136,0.8)] transition-transform active:scale-95"
                  >
                    Create User ID
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </Magnetic>
              </div>
            </TiltCard>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 60, rotateY: -20 }}
            whileInView={{ opacity: 1, x: 0, rotateY: 0 }}
            viewport={{ once: false, amount: 0.4 }}
            transition={{ duration: 0.7, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            style={{ transformPerspective: 1000 }}
          >
            <TiltCard
              max={6}
              className="glass-strong glass-sheen relative flex h-full flex-col overflow-hidden rounded-3xl p-8 transition-shadow hover:glow-border"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10">
                <Flame className="h-5 w-5 text-[#34d399]" />
              </span>
              <h3 className="mt-6 text-2xl font-semibold tracking-tight">Returning user</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Continue your streak. Enter your User ID and pick up right where you left off.
              </p>
              <div className="mt-8">
                <Magnetic strength={0.3}>
                  <button
                    onClick={() => setMode("returning")}
                    className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-white/10"
                  >
                    Enter User ID
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </Magnetic>
              </div>
            </TiltCard>
          </motion.div>
        </div>
      </div>

      <AnimatePresence>
        {mode && (
          <UserModal
            mode={mode}
            onClose={() => setMode(null)}
            onSuccess={(user) => {
              setCurrentUser(user.userId)
              onEnterApp(user)
            }}
          />
        )}
      </AnimatePresence>
    </section>
  )
}

function AnimatedHeading({ text, className }: { text: string; className?: string }) {
  const words = text.split(" ")
  return (
    <h2 className={className} style={{ perspective: "800px" }}>
      <span className="sr-only">{text}</span>
      <motion.span
        aria-hidden
        initial="hidden"
        whileInView="show"
        viewport={{ once: false, amount: 0.7 }}
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
        className="inline-flex flex-wrap justify-center gap-x-[0.28em]"
      >
        {words.map((word, wi) => (
          <span key={wi} className="inline-flex overflow-hidden pb-1">
            {word.split("").map((ch, ci) => (
              <motion.span
                key={ci}
                variants={{
                  hidden: { y: "110%", rotateX: -80, opacity: 0 },
                  show: {
                    y: "0%",
                    rotateX: 0,
                    opacity: 1,
                    transition: { type: "spring", stiffness: 220, damping: 22 },
                  },
                }}
                className="inline-block"
                style={{ transformOrigin: "bottom center" }}
              >
                {ch}
              </motion.span>
            ))}
          </span>
        ))}
      </motion.span>
    </h2>
  )
}

/* -------------------------------------------------------------------------- */
/* User verification paper-flip overlay modal                                */
/* -------------------------------------------------------------------------- */

function UserModal({
  mode,
  onClose,
  onSuccess,
}: {
  mode: "new" | "returning"
  onClose: () => void
  onSuccess: (user: HabitUser) => void
}) {
  const [username, setUsername] = useState("")
  const [userId, setUserId] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false) // Track network state

  const handleContinue = async () => {
    setError("")
    const cleanId = userId.trim().toLowerCase() // Normalize input to match Firestore IDs smoothly

    if (!cleanId) {
      setError("Please fill in the fields to continue.")
      return
    }

    setLoading(true)

    try {
      // Fetch user records live from Google Firebase Firestore
      const foundUser = await getUser(cleanId)

      if (mode === "new") {
        if (!username.trim()) {
          setError("Please define a display profile name.")
          setLoading(false)
          return
        }
        
        // Prevent registering an ID that already exists in the cloud database
        if (foundUser) {
          setError("That User ID is already taken. Try another.")
          setLoading(false)
          return
        }

        const user: HabitUser = {
          username: username.trim(),
          userId: cleanId,
          createdAt: Date.now(),
          streak: 1,
          habits: [],
        }

        // Save new user profile directly to Firebase Firestore collection
        await saveUser(user)
        onSuccess(user)
      } else {
        // Handle Returning User Lookup
        if (!foundUser) {
          setError("We couldn't find that User ID. Check it and try again.")
          setLoading(false)
          return
        }
        onSuccess(foundUser)
      }
    } catch (err: any) {
      setError(err.message || "A cloud database transaction error occurred.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ perspective: "1600px" }}
    >
      <motion.div
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.div
        initial={{ rotateY: -100, x: -80, opacity: 0, scale: 0.9 }}
        animate={{ rotateY: 0, x: 0, opacity: 1, scale: 1 }}
        exit={{ rotateY: 90, x: 60, opacity: 0, scale: 0.92 }}
        transition={{ type: "spring", stiffness: 140, damping: 18, mass: 0.9 }}
        style={{ transformOrigin: "left center", backfaceVisibility: "hidden" }}
        className="glass-strong glass-sheen glow-border relative z-[70] w-full max-w-md rounded-3xl p-7"
      >
        <motion.div
          aria-hidden
          initial={{ opacity: 0.7 }}
          animate={{ opacity: 0 }}
          exit={{ opacity: 0.6 }}
          transition={{ duration: 0.7 }}
          className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-r from-black/70 via-black/20 to-transparent"
        />

        <button
          onClick={onClose}
          aria-label="Close"
          disabled={loading}
          className="absolute right-5 top-5 z-[80] rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-30"
        >
          <X className="h-4 w-4" />
        </button>

        <motion.div
          initial={{ opacity: 0, rotateX: 12, y: 10 }}
          animate={{ opacity: 1, rotateX: 0, y: 0 }}
          transition={{ delay: 0.18, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          style={{ transformPerspective: 900 }}
        >
          <h3 className="text-xl font-semibold tracking-tight">
            {mode === "new" ? "Create your identity" : "Welcome back"}
          </h3>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {mode === "new"
              ? "Choose a username and a unique User ID."
              : "Enter your User ID to continue your streak."}
          </p>

          <div className="mt-6 space-y-4">
            {mode === "new" && (
              <Field 
                label="Username" 
                value={username} 
                onChange={setUsername} 
                placeholder="e.g. Alex Rivera" 
              />
            )}
            <Field
              label="User ID"
              value={userId}
              onChange={setUserId}
              placeholder="e.g. alex-2026"
              onEnter={handleContinue}
            />
          </div>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -6, height: 0 }}
                animate={{ opacity: 1, y: 0, height: "auto" }}
                exit={{ opacity: 0, y: -6, height: 0 }}
                className="mt-4 flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive"
              >
                <motion.span
                  animate={{ x: [0, -4, 4, -3, 3, 0] }}
                  transition={{ duration: 0.4 }}
                  className="flex items-center gap-2"
                >
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </motion.span>
              </motion.div>
            )}
          </AnimatePresence>

          <Magnetic strength={0.2} className="mt-6">
            <button
              onClick={handleContinue}
              disabled={loading}
              className="w-full rounded-full bg-gradient-to-r from-[#34d399] to-[#0d9488] px-6 py-3.5 text-sm font-medium text-white shadow-[0_10px_40px_-12px_rgba(13,148,136,0.8)] disabled:opacity-50 active:scale-[0.98] transition-all text-center"
            >
              {loading ? "Checking Database..." : "Continue"}
            </button>
          </Magnetic>
        </motion.div>
      </motion.div>
    </motion.div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  onEnter,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  onEnter?: () => void
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) onEnter?.()
        }}
        placeholder={placeholder}
        className="w-full rounded-xl border border-white/12 bg-white/5 px-4 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-[#34d399]/60 focus:bg-white/10"
      />
    </label>
  )
}

/* -------------------------------------------------------------------------- */
/* Main Switchboard Gate Layout                                              */
/* -------------------------------------------------------------------------- */

export default function Page() {
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    const session = localStorage.getItem("habit_current_user")
    if (session) {
      window.location.href = "/tracker.html"
    } else {
      setChecked(true)
    }
  }, [])

  if (!checked) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[#040c08] text-sm text-muted-foreground tracking-widest font-mono">
        INITIALIZING DATA PIPELINES...
      </div>
    )
  }

  return (
    <>
      <Background3D />
      <SiteNav onGetStarted={() => document.getElementById("final")?.scrollIntoView({ behavior: "smooth" })} />
      <ScrollProgress />

      <main className="relative">
        <Hero />
        <SplitIntro />
        <CarouselStory />
        
        <FinalScreen onEnterApp={(user) => {
          localStorage.setItem("habit_current_user", user.userId)
          window.location.href = "/tracker.html"
        }} />
      </main>
    </>
  )
}