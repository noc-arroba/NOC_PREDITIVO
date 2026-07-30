#!/usr/bin/env python3
"""
OTIA — Monitoramento Duplo de Rotas
Compara latência, perda e rota a partir de:
1. RB TESTE-BANDA-WELLINHO (dentro da rede Arroba)
2. Sandbox/Cloud (origem externa)

Executa pings e traceroutes simultâneos para os mesmos alvos
e gera um comparativo lado a lado.
"""

import paramiko
import warnings
import json
import time
import re
import subprocess
import statistics
from datetime import datetime

warnings.filterwarnings('ignore')

RB_HOST = '143.137.32.232'
RB_PORT = 224
RB_USER = 'otia'
RB_PASS = 'Arr0b@2019Bl'

# Alvos comuns (acessíveis de ambas as origens)
COMMON_TARGETS = [
    {'name': 'Google-DNS', 'ip': '8.8.8.8', 'role': 'dns'},
    {'name': 'Cloudflare-DNS', 'ip': '1.1.1.1', 'role': 'dns'},
]

# Alvos exclusivos da RB (infraestrutura interna)
RB_ONLY_TARGETS = [
    {'name': 'Gateway-MX204-SR', 'ip': '143.137.32.4', 'role': 'gateway'},
    {'name': 'CCR-Centro', 'ip': '143.137.32.7', 'role': 'core'},
    {'name': 'IX-BR-SP', 'ip': '187.16.222.6', 'role': 'ix'},
]

# Alvos exclusivos do Sandbox (acessíveis externamente)
SANDBOX_ONLY_TARGETS = [
    {'name': 'CCR-Santa-Rosa', 'ip': '143.137.32.6', 'role': 'core'},
    {'name': 'RB-Cliente', 'ip': '143.137.32.232', 'role': 'rb'},
]

# ============================================
# SSH RB — funções
# ============================================

def ssh_connect():
    transport = paramiko.Transport((RB_HOST, RB_PORT))
    sec = transport.get_security_options()
    sec.kex = ('diffie-hellman-group1-sha1',)
    sec.key_types = ('ssh-dss',)
    sec.ciphers = ('aes128-ctr',)
    transport.start_client()
    transport.auth_password(RB_USER, RB_PASS)
    return transport

def ssh_exec(transport, cmd):
    chan = transport.open_session()
    chan.exec_command(cmd)
    output = b''
    while True:
        if chan.recv_ready():
            output += chan.recv(4096)
        elif chan.exit_status_ready():
            while chan.recv_ready():
                output += chan.recv(4096)
            break
        time.sleep(0.05)
    return output.decode('utf-8', errors='replace')

def parse_mikrotik_ping(output):
    rtts = []
    for line in output.split('\n'):
        if re.match(r'\s+\d+\s+\d+\.\d+\.\d+\.\d+\s+\d+\s+\d+\s+(\d+)ms', line):
            m = re.search(r'(\d+)ms\s*$', line)
            if m:
                rtts.append(int(m.group(1)))
    
    result = {'rtts': rtts}
    summary = re.search(
        r'sent=(\d+)\s+received=(\d+)\s+packet-loss=(\d+)%\s+min-rtt=(\d+)ms\s+avg-rtt=(\d+)ms\s+max-rtt=(\d+)ms',
        output
    )
    if summary:
        result.update({
            'packetLoss': int(summary.group(3)),
            'minRtt': int(summary.group(4)),
            'avgRtt': int(summary.group(5)),
            'maxRtt': int(summary.group(6)),
        })
        if len(rtts) >= 2:
            result['jitter'] = round(statistics.stdev(rtts), 2)
        else:
            result['jitter'] = result['maxRtt'] - result['minRtt']
    else:
        result['packetLoss'] = 100
        result['avgRtt'] = 0
        result['minRtt'] = 0
        result['maxRtt'] = 0
        result['jitter'] = 0
    return result

def parse_mikrotik_traceroute(output):
    hops = []
    for line in output.split('\n'):
        match = re.search(
            r'^\s*(\d+)\s+(\S+)\s+(\d+)%\s+(\d+)\s+([\d.]+)ms\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)',
            line
        )
        if match:
            hops.append({
                'hop': int(match.group(1)),
                'address': match.group(2),
                'loss': int(match.group(3)),
                'avg': float(match.group(6)),
            })
    return hops

# ============================================
# Sandbox — funções
# ============================================

def sandbox_ping(ip, count=10):
    try:
        result = subprocess.run(
            ['ping', '-c', str(count), '-i', '0.5', ip],
            capture_output=True, text=True, timeout=15
        )
        output = result.stdout
        
        stats_line = [l for l in output.split('\n') if 'rtt min' in l]
        loss_line = [l for l in output.split('\n') if 'packet loss' in l]
        
        loss = 100
        if loss_line:
            m = re.search(r'(\d+)% packet loss', loss_line[0])
            if m:
                loss = int(m.group(1))
        
        if stats_line:
            m = re.match(r'rtt min/avg/max/mdev = ([\d.]+)/([\d.]+)/([\d.]+)/([\d.]+) ms', stats_line[0])
            if m:
                return {
                    'packetLoss': loss,
                    'minRtt': round(float(m.group(1)), 1),
                    'avgRtt': round(float(m.group(2)), 1),
                    'maxRtt': round(float(m.group(3)), 1),
                    'jitter': round(float(m.group(4)), 2),
                }
        
        return {'packetLoss': loss, 'minRtt': 0, 'avgRtt': 0, 'maxRtt': 0, 'jitter': 0}
    except Exception as e:
        return {'packetLoss': 100, 'minRtt': 0, 'avgRtt': 0, 'maxRtt': 0, 'jitter': 0, 'error': str(e)}

def sandbox_traceroute(ip, max_hops=15):
    hops = []
    try:
        result = subprocess.run(
            ['traceroute', '-n', '-m', str(max_hops), '-w', '2', '-q', '1', ip],
            capture_output=True, text=True, timeout=30
        )
        for line in result.stdout.split('\n'):
            line = line.strip()
            if not line or line.startswith('traceroute'):
                continue
            parts = line.split()
            if len(parts) >= 2:
                hop_num = parts[0]
                addr = parts[1] if parts[1] != '*' else '*'
                rtt = None
                for p in parts[2:]:
                    if 'ms' in p:
                        rtt = float(p.replace('ms', ''))
                        break
                hops.append({
                    'hop': int(hop_num) if hop_num.isdigit() else len(hops) + 1,
                    'address': addr,
                    'avg': rtt if rtt else 0,
                    'loss': 0 if addr != '*' else 100,
                })
    except Exception:
        pass
    return hops

# ============================================
# Comparativo
# ============================================

def run_dual_monitor():
    timestamp = datetime.now().isoformat()
    print("=" * 60)
    print("OTIA — MONITORAMENTO DUPLO DE ROTAS")
    print(f"RB TESTE-BANDA-WELLINHO vs SANDBOX/Cloud")
    print(f"Timestamp: {timestamp}")
    print("=" * 60)
    
    # === RB MEASUREMENTS ===
    print("\n[1/4] Conectando RB via SSH...")
    transport = ssh_connect()
    print("  ✅ RB conectada!")
    
    # System status
    sysinfo = ssh_exec(transport, "/system resource print")
    rb_status = {}
    for line in sysinfo.split('\n'):
        if 'uptime:' in line:
            rb_status['uptime'] = line.split('uptime:')[1].strip()
        elif 'version:' in line:
            rb_status['version'] = line.split('version:')[1].strip()
        elif 'cpu-load:' in line:
            rb_status['cpuLoad'] = int(re.search(r'(\d+)', line.split('cpu-load:')[1]).group(1))
        elif 'free-memory:' in line:
            rb_status['freeMemory'] = line.split('free-memory:')[1].strip()
    
    print(f"  RouterOS: {rb_status.get('version', '?')}")
    print(f"  Uptime: {rb_status.get('uptime', '?')}")
    print(f"  CPU: {rb_status.get('cpuLoad', '?')}%")
    print(f"  RAM livre: {rb_status.get('freeMemory', '?')}")
    
    # RB Pings
    print("\n[2/4] Medindo latência a partir da RB...")
    rb_pings = []
    all_targets = COMMON_TARGETS + RB_ONLY_TARGETS
    for target in all_targets:
        output = ssh_exec(transport, f'/ping {target["ip"]} count=10')
        parsed = parse_mikrotik_ping(output)
        parsed['name'] = target['name']
        parsed['ip'] = target['ip']
        parsed['role'] = target['role']
        parsed['source'] = 'rb'
        rb_pings.append(parsed)
        
        status_icon = "✅" if parsed['packetLoss'] == 0 else "⚠️"
        print(f"  {status_icon} {target['name']:20s} avg={parsed['avgRtt']:>3}ms loss={parsed['packetLoss']}% jitter={parsed['jitter']}ms")
    
    # RB Traceroute
    rb_trace_output = ssh_exec(transport, '/tool traceroute address=8.8.8.8 count=1')
    rb_traceroute = parse_mikrotik_traceroute(rb_trace_output)
    
    transport.close()
    
    # === SANDBOX MEASUREMENTS ===
    print("\n[3/4] Medindo latência a partir do Sandbox (nuvem)...")
    sb_pings = []
    sb_targets = COMMON_TARGETS + SANDBOX_ONLY_TARGETS
    for target in sb_targets:
        result = sandbox_ping(target['ip'])
        result['name'] = target['name']
        result['ip'] = target['ip']
        result['role'] = target['role']
        result['source'] = 'sandbox'
        sb_pings.append(result)
        
        status_icon = "✅" if result['packetLoss'] == 0 else "❌"
        print(f"  {status_icon} {target['name']:20s} avg={result['avgRtt']:>6.1f}ms loss={result['packetLoss']}% jitter={result['jitter']}ms")
    
    # Sandbox Traceroute para 8.8.8.8
    sb_traceroute = sandbox_traceroute('8.8.8.8')
    
    # === COMPARATIVO ===
    print("\n[4/4] Gerando comparativo...")
    print()
    print("=" * 60)
    print("TABELA COMPARATIVA — RB vs SANDBOX")
    print("=" * 60)
    print()
    print(f"{'Alvo':<22} {'RB Avg':>8} {'SB Avg':>8} {'RB Loss':>8} {'SB Loss':>8} {'Diferença':>10}")
    print("-" * 60)
    
    for name in [t['name'] for t in COMMON_TARGETS]:
        rb = next((p for p in rb_pings if p['name'] == name), {'avgRtt': 0, 'packetLoss': 100})
        sb = next((p for p in sb_pings if p['name'] == name), {'avgRtt': 0, 'packetLoss': 100})
        
        diff = sb['avgRtt'] - rb['avgRtt'] if rb['avgRtt'] > 0 and sb['avgRtt'] > 0 else 0
        diff_str = f"{diff:+.1f}ms" if diff != 0 else "—"
        print(f"{name:<22} {rb['avgRtt']:>6}ms {sb['avgRtt']:>6.1f}ms {rb['packetLoss']:>6}% {sb['packetLoss']:>6}% {diff_str:>10}")
    
    print()
    print("--- Traceroute RB → 8.8.8.8 (dentro da rede) ---")
    for hop in rb_traceroute:
        print(f"  {hop['hop']:2d}. {hop['address']:20s} {hop['avg']}ms")
    
    print()
    print("--- Traceroute Sandbox → 8.8.8.8 (nuvem) ---")
    if sb_traceroute:
        for hop in sb_traceroute:
            addr = hop.get('address', '*')
            avg = hop.get('avg', 0)
            print(f"  {hop['hop']:2d}. {addr:20s} {avg}ms" if avg else f"  {hop['hop']:2d}. {addr:20s} *")
    else:
        print("  (traceroute bloqueado pelo ambiente gVisor)")
        print(f"  Latência direta: {next((p['avgRtt'] for p in sb_pings if p['name'] == 'Google-DNS'), 0):.1f}ms")
    
    # === SALVAR RESULTADO ===
    result = {
        'timestamp': timestamp,
        'rb_status': rb_status,
        'rb_pings': [{k: v for k, v in p.items() if k != 'rtts'} for p in rb_pings],
        'sandbox_pings': sb_pings,
        'rb_traceroute': rb_traceroute,
        'sandbox_traceroute': sb_traceroute,
    }
    
    with open('/tmp/otia_dual_route.json', 'w') as f:
        json.dump(result, f, indent=2)
    
    print()
    print("=" * 60)
    print("✅ Monitoramento duplo concluído!")
    print(f"   Resultado salvo em /tmp/otia_dual_route.json")
    print("=" * 60)
    
    return result

if __name__ == '__main__':
    run_dual_monitor()
