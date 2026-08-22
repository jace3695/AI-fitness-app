'use client'

export default function FixedSpaceBackground() {
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: -1, pointerEvents: 'none', overflow: 'hidden', background: 'linear-gradient(180deg, #010510 0%, #020d24 40%, #041530 70%, #0F0F14 100%)' }}>
      <canvas
        ref={el => {
          if (!el) return
          const ctx = el.getContext('2d')!
          el.width = window.innerWidth
          el.height = window.innerHeight
          const gradient = ctx.createLinearGradient(0, el.height * 0.6, el.width, el.height * 0.1)
          gradient.addColorStop(0, 'transparent')
          gradient.addColorStop(0.2, 'rgba(30,80,180,0.15)')
          gradient.addColorStop(0.4, 'rgba(60,120,220,0.35)')
          gradient.addColorStop(0.5, 'rgba(100,160,255,0.45)')
          gradient.addColorStop(0.6, 'rgba(60,120,220,0.35)')
          gradient.addColorStop(0.8, 'rgba(30,80,180,0.15)')
          gradient.addColorStop(1, 'transparent')
          ctx.save()
          ctx.translate(el.width / 2, el.height / 2)
          ctx.rotate(-30 * Math.PI / 180)
          ctx.fillStyle = gradient
          ctx.filter = 'blur(20px)'
          ctx.fillRect(-el.width, -el.height, el.width * 2, el.height * 2)
          ctx.restore()
          for (let i = 0; i < 300; i++) {
            const angle = -30 * Math.PI / 180
            const spread = (Math.random() - 0.5) * el.height * 0.3
            const along = Math.random() * el.width * 1.5 - el.width * 0.2
            const x = Math.cos(angle) * along - Math.sin(angle) * spread
            const y = Math.sin(angle) * along + Math.cos(angle) * spread + el.height * 0.3
            const size = Math.random() * 1.5 + 0.3
            const opacity = Math.random() * 0.8 + 0.2
            ctx.beginPath()
            ctx.arc(x, y, size, 0, Math.PI * 2)
            ctx.fillStyle = `rgba(${180 + Math.random() * 75}, ${200 + Math.random() * 55}, 255, ${opacity})`
            ctx.fill()
          }
        }}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
      />
      {Array.from({ length: 120 }, (_, i) => {
        const size = Math.random() * 3 + 0.5
        const isBright = i % 8 === 0
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              width: size,
              height: size,
              background: isBright ? '#e0f0ff' : '#ffffff',
              borderRadius: '50%',
              top: `${Math.random() * 80}%`,
              left: `${Math.random() * 100}%`,
              animation: `twinkle${i % 3} ${Math.random() * 2 + 1.5}s infinite alternate`,
              boxShadow: isBright ? `0 0 ${size * 3}px #a0d4ff, 0 0 ${size * 6}px #6aaaff88` : 'none'
            }}
          />
        )
      })}
      {[{ top: '8%', left: '15%', delay: '0s', angle: 35 }, { top: '18%', left: '45%', delay: '2.5s', angle: 30 }, { top: '5%', left: '65%', delay: '5s', angle: 40 }, { top: '22%', left: '25%', delay: '7s', angle: 33 }, { top: '12%', left: '75%', delay: '9s', angle: 38 }].map((s, i) => (
        <div key={i} style={{ position: 'absolute', top: s.top, left: s.left, width: 100, height: 2, background: 'linear-gradient(90deg, white, #a0d4ff, transparent)', borderRadius: 2, transform: `rotate(${s.angle}deg)`, animation: `shooting 4s linear infinite`, animationDelay: s.delay, opacity: 0, boxShadow: '0 0 4px white' }} />
      ))}
      <div style={{ position: 'absolute', top: '8%', right: '15%', width: 120, height: 120, borderRadius: '50%', background: 'radial-gradient(circle at 35% 35%, #e8f0ff 0%, #c8d8f0 30%, #a0b8e0 60%, #8090c0 100%)', boxShadow: '0 0 40px #c8d8f088, 0 0 80px #a0b8e044', animation: 'float 8s ease-in-out infinite' }}>
        <div style={{ position: 'absolute', top: '20%', left: '25%', width: 20, height: 20, borderRadius: '50%', background: 'rgba(100,120,160,0.3)' }} />
        <div style={{ position: 'absolute', top: '45%', left: '55%', width: 14, height: 14, borderRadius: '50%', background: 'rgba(100,120,160,0.25)' }} />
        <div style={{ position: 'absolute', top: '60%', left: '20%', width: 18, height: 18, borderRadius: '50%', background: 'rgba(100,120,160,0.2)' }} />
        <div style={{ position: 'absolute', top: '30%', left: '60%', width: 10, height: 10, borderRadius: '50%', background: 'rgba(100,120,160,0.2)' }} />
      </div>
      {[{ top: '18%', right: '5%', scale: 1.0 }, { top: '22%', right: '20%', scale: 0.7 }].map((c, i) => (
        <div key={i} style={{ position: 'absolute', top: c.top, right: c.right, animation: `cloud ${10 + i * 3}s ease-in-out infinite alternate` }}>
          <div style={{ position: 'relative', transform: `scale(${c.scale})` }}>
            <div style={{ position: 'absolute', width: 100, height: 40, background: 'rgba(255,255,255,0.15)', borderRadius: 40, bottom: 0, left: 20, filter: 'blur(4px)' }} />
            <div style={{ position: 'absolute', width: 60, height: 55, background: 'rgba(255,255,255,0.12)', borderRadius: '50%', bottom: 20, left: 30, filter: 'blur(4px)' }} />
            <div style={{ position: 'absolute', width: 45, height: 45, background: 'rgba(255,255,255,0.1)', borderRadius: '50%', bottom: 15, left: 70, filter: 'blur(4px)' }} />
            <div style={{ width: 150, height: 50, background: 'transparent' }} />
          </div>
        </div>
      ))}
      <style>{`
        @keyframes twinkle0 { from { opacity: 0.2; transform: scale(0.8); } to { opacity: 1; transform: scale(1.4); } }
        @keyframes twinkle1 { from { opacity: 0.5; transform: scale(1); } to { opacity: 0.1; transform: scale(0.7); } }
        @keyframes twinkle2 { from { opacity: 0.8; transform: scale(1.2); } to { opacity: 0.3; transform: scale(0.9); } }
        @keyframes float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        @keyframes cloud { from { transform: translateX(0); } to { transform: translateX(15px); } }
        @keyframes shooting { 0% { transform: rotate(35deg) translateX(0); opacity: 0; } 5% { opacity: 1; } 70% { opacity: 0.8; } 100% { transform: rotate(35deg) translateX(400px); opacity: 0; } }
      `}</style>
    </div>
  )
}

