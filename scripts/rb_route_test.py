#!/usr/bin/env python3
"""
OTIA — Teste de Rotas para Principais Serviços
RB: TESTE-BANDA-WELLINHO (143.137.32.232:224)
"""

import paramiko
import warnings
import re
import time
from datetime import datetime

warnings.filterwarnings('ignore')

RB_HOST = '143.137.32.232'
RB_PORT = 224
RB_USER = 'otia'
RB_PASS = 'Arr0b@2019Bl'

# Principais serviços e infraestrutura
TARGETS = [
    # Infra interna
    {'name': 'Gateway MX204 Sta Rosa', 'ip': '143.137.32.4', 'type': 'gateway'},
    {'name': 'CCR Centro', 'ip': '143.137.32.7', 'type': 'core'},
    {'name': 'CCR Santa Rosa', 'ip': '143.137.32.6', 'type': 'core'},
    # Upstreams / Trânsito
    {'name': 'IX-BR SP', 'ip': '187.16.222.6', 'type': 'ix'},
    {'name': 'IX-BR RJ', 'ip': '187.16.222.10', 'type': 'ix'},
    # DNS públicos
    {'name': 'Google DNS', 'ip': '8.8.8.8', 'type': 'dns'},
    {'name': 'Cloudflare DNS', 'ip': '1.1.1.1', 'type': 'dns'},
    # CDNs e serviços
    {'name': 'Google', 'ip': '142.250.139.46', 'type': 'cdn'},
    {'name': 'YouTube', 'ip': '142.250.190.78', 'type': 'cdn'},
    {'name': 'Netflix OCA', 'ip': '187.16.222.6', 'type': 'cdn'},
    {'name': 'Facebook', 'ip': '157.240.12.35', 'type': 'cdn'},
    {'name': 'WhatsApp', 'ip': '157.240.12.53', 'type': 'cdn'},
    {'name': 'Instagram', 'ip': '157.240.12.35', 'type': 'cdn'},
    {'name': 'TikTok', 'ip': '151.101.1.53', 'type': 'cdn'},
    {'name': 'Amazon S3', 'ip': '52.94.236.248', 'type': 'cloud'},
    {'name': 'Microsoft Azure', 'ip': '20.190.128.0', 'type': 'cloud'},
    {'name': 'Cloudflare CDN', 'ip': '104.16.132.229', 'type': 'cdn'},
    # Bancos e governamento
    {'name': 'Banco do Brasil', 'ip': '170.66.12.244', 'type': 'bank'},
    {'name': 'Caixa', 'ip': '200.201.172.1', 'type': 'bank'},
    {'name': 'Receita Federal', 'ip': '161.148.1.1', 'type': 'gov'},
]

def ssh_connect():
    transport = paramiko.Transport((RB_HOST, RB_PORT))
    sec = transport.get_security_options()
    sec.kex = ('diffie-hellman-group1-sha1',)
    sec.key_types = ('ssh-dss',)
    sec.ciphers = ('aes128-ctr',)
    transport.start_client()
    transport.auth_password(RB_USER, RB_PASS)
    return transport

def ssh_exec(transport, cmd, timeout=30):
    chan = transport.open_session()
    chan.settimeout(timeout)
    chan.exec_command(cmd)
    output = b''
    try:
        while True:
            if chan.recv_ready():
                output += chan.recv(4096)
            elif chan.exit_status_ready():
                while chan.recv_ready():
                    output += chan.recv(4096)
                break
            time.sleep(0.05)
    except Exception:
        pass
    return output.decode('utf-8', errors='replace')

def parse_ping(output):
    result = {}
    summary = re.search(
        r'sent=(\d+)\s+received=(\d+)\s+packet-loss=(\d+)%\s+min-rtt=(\d+)ms\s+avg-rtt=(\d+)ms\s+max-rtt=(\d+)ms',
        output
    )
    if summary:
        result = {
            'sent': int(summary.group(1)),
            'received': int(summary.group(2)),
            'loss': int(summary.group(3)),
            'min': int(summary.group(4)),
            'avg': int(summary.group(5)),
            'max': int(summary.group(6)),
        }
    return result

def parse_traceroute(output):
    hops = []
    for line in output.split('\n'):
        match = re.search(
            r'^\s*(\d+)\s+(\S+)\s+(\d+)%\s+(\d+)\s+([\d.]+)ms\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)',
            line
        )
        if match:
            hops.append({
                'hop': int(match.group(1)),
                'addr': match.group(2),
                'loss': int(match.group(3)),
                'avg': float(match.group(6)),
            })
    return hops

def main():
    print("=" * 70)
    print("OTIA — Teste de Rotas para Principais Serviços")
    print(f"RB: TESTE-BANDA-WELLINHO ({RB_HOST}:{RB_PORT})")
    print(f"Data: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)
    
    transport = ssh_connect()
    print("✅ SSH conectado!\n")
    
    # 1. PING para todos os alvos
    print("═" * 70)
    print("PING — 5 pacotes por alvo")
    print("═" * 70)
    print(f"{'ALVO':<30} {'IP':<18} {'AVG':>6} {'LOSS':>5} {'MIN':>5} {'MAX':>5}  STATUS")
    print("─" * 70)
    
    results = []
    for t in TARGETS:
        output = ssh_exec(transport, f'/ping {t["ip"]} count=5', timeout=20)
        p = parse_ping(output)
        
        if not p:
            # Timeout
            p = {'avg': 0, 'loss': 100, 'min': 0, 'max': 0}
        
        status = '✅' if p.get('loss', 100) == 0 else '⚠️' if p.get('loss', 100) < 50 else '❌'
        print(f"{t['name']:<30} {t['ip']:<18} {p.get('avg',0):>4}ms {p.get('loss',0):>4}% {p.get('min',0):>4}ms {p.get('max',0):>4}ms  {status}")
        
        results.append({**t, **p})
        time.sleep(0.3)
    
    # 2. TRACEROUTE para os serviços mais importantes
    print("\n" + "═" * 70)
    print("TRACEROUTE — Principais destinos")
    print("═" * 70)
    
    trace_targets = [
        ('Google DNS', '8.8.8.8'),
        ('Cloudflare', '1.1.1.1'),
        ('IX-BR SP', '187.16.222.6'),
        ('Facebook/WhatsApp', '157.240.12.35'),
    ]
    
    for name, ip in trace_targets:
        print(f"\n── {name} ({ip}) ──")
        output = ssh_exec(transport, f'/tool traceroute {ip} count=1', timeout=30)
        hops = parse_traceroute(output)
        if hops:
            for h in hops:
                loss_marker = f" ⚠️ {h['loss']}% LOSS" if h['loss'] > 0 else ""
                print(f"  {h['hop']:2d}. {h['addr']:<20} {h['avg']:>8.1f}ms{loss_marker}")
        else:
            # Fallback: print raw output
            for line in output.strip().split('\n')[:8]:
                print(f"  {line}")
        time.sleep(0.5)
    
    # 3. Resumo
    print("\n" + "═" * 70)
    print("RESUMO")
    print("═" * 70)
    
    ok = sum(1 for r in results if r.get('loss', 100) == 0)
    warn = sum(1 for r in results if 0 < r.get('loss', 100) < 50)
    fail = sum(1 for r in results if r.get('loss', 100) >= 50)
    
    print(f"  ✅ OK: {ok} alvos")
    print(f"  ⚠️  Perda parcial: {warn} alvos")
    print(f"  ❌ Indisponível: {fail} alvos")
    print(f"  Total testado: {len(results)} alvos")
    
    avg_latency = sum(r.get('avg', 0) for r in results if r.get('loss', 100) == 0) / max(ok, 1)
    print(f"  Latência média (OK): {avg_latency:.1f}ms")
    
    # Top 5 mais lentos
    slow = sorted([r for r in results if r.get('avg', 0) > 0], key=lambda x: x.get('avg', 0), reverse=True)[:5]
    if slow:
        print(f"\n  Mais lentos:")
        for s in slow:
            print(f"    {s['name']:<30} {s['avg']}ms ({s['loss']}% loss)")
    
    # Problemas
    problems = [r for r in results if r.get('loss', 0) > 0]
    if problems:
        print(f"\n  ⚠️  Alvos com perda:")
        for p in problems:
            print(f"    {p['name']:<30} {p['ip']:<16} {p.get('loss',0)}% perda")
    else:
        print(f"\n  ✅ Nenhuma perda de pacotes detectada!")
    
    transport.close()
    print(f"\n✅ Teste concluído em {datetime.now().strftime('%H:%M:%S')}")

if __name__ == '__main__':
    main()
