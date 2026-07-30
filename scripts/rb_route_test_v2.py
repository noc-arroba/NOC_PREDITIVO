#!/usr/bin/env python3
"""
OTIA — Teste de Rotas v2 (DNS resolution via RB)
"""
import paramiko, warnings, re, time
from datetime import datetime
warnings.filterwarnings('ignore')

RB_HOST = '143.137.32.232'
RB_PORT = 224
RB_USER = 'otia'
RB_PASS = 'Arr0b@2019Bl'

# Usar nomes DNS para a RB resolver
TARGETS = [
    # Infra interna
    {'name': 'Gateway MX204', 'ip': '143.137.32.4', 'type': 'infra'},
    {'name': 'CCR Centro', 'ip': '143.137.32.7', 'type': 'infra'},
    {'name': 'CCR Sta Rosa', 'ip': '143.137.32.6', 'type': 'infra'},
    # IX
    {'name': 'IX-BR SP', 'ip': '187.16.222.6', 'type': 'ix'},
    {'name': 'IX-BR RJ', 'ip': '187.16.222.10', 'type': 'ix'},
    # DNS
    {'name': 'Google DNS', 'ip': '8.8.8.8', 'type': 'dns'},
    {'name': 'Cloudflare DNS', 'ip': '1.1.1.1', 'type': 'dns'},
    # Serviços por DNS
    {'name': 'Google', 'ip': 'google.com', 'type': 'web'},
    {'name': 'YouTube', 'ip': 'youtube.com', 'type': 'web'},
    {'name': 'Facebook', 'ip': 'facebook.com', 'type': 'web'},
    {'name': 'WhatsApp', 'ip': 'whatsapp.com', 'type': 'web'},
    {'name': 'Instagram', 'ip': 'instagram.com', 'type': 'web'},
    {'name': 'TikTok', 'ip': 'tiktok.com', 'type': 'web'},
    {'name': 'Netflix', 'ip': 'netflix.com', 'type': 'web'},
    {'name': 'Amazon', 'ip': 'amazon.com', 'type': 'web'},
    {'name': 'Microsoft', 'ip': 'microsoft.com', 'type': 'web'},
    {'name': 'GitHub', 'ip': 'github.com', 'type': 'web'},
    {'name': 'Cloudflare', 'ip': 'cloudflare.com', 'type': 'web'},
    {'name': 'Banco do Brasil', 'ip': 'bb.com.br', 'type': 'bank'},
    {'name': 'Caixa', 'ip': 'caixa.gov.br', 'type': 'bank'},
    {'name': 'Bradesco', 'ip': 'bradesco.com.br', 'type': 'bank'},
    {'name': 'Itau', 'ip': 'itau.com.br', 'type': 'bank'},
    {'name': 'Receita Federal', 'ip': 'gov.br', 'type': 'gov'},
    {'name': 'Spotify', 'ip': 'spotify.com', 'type': 'web'},
    {'name': 'Twitch', 'ip': 'twitch.tv', 'type': 'web'},
    {'name': 'Steam', 'ip': 'steam.com', 'type': 'web'},
    {'name': 'Pix API BB', 'ip': 'api.bb.com.br', 'type': 'bank'},
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

def ssh_exec(transport, cmd, timeout=20):
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
    except:
        pass
    return output.decode('utf-8', errors='replace')

def parse_ping(output):
    result = {}
    # Extract resolved IP
    ip_match = re.search(r'(\d+\.\d+\.\d+\.\d+)', output.split('\n')[0] if output else '')
    if ip_match:
        result['resolved_ip'] = ip_match.group(1)
    
    summary = re.search(
        r'sent=(\d+)\s+received=(\d+)\s+packet-loss=(\d+)%\s+min-rtt=(\d+)ms\s+avg-rtt=(\d+)ms\s+max-rtt=(\d+)ms',
        output
    )
    if summary:
        result.update({
            'sent': int(summary.group(1)),
            'received': int(summary.group(2)),
            'loss': int(summary.group(3)),
            'min': int(summary.group(4)),
            'avg': int(summary.group(5)),
            'max': int(summary.group(6)),
        })
    else:
        result.update({'avg': 0, 'loss': 100, 'min': 0, 'max': 0, 'received': 0})
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
    print("=" * 75)
    print("OTIA — Teste de Rotas v2 — Resolução DNS via RB")
    print(f"RB: TESTE-BANDA-WELLINHO ({RB_HOST}:{RB_PORT})")
    print(f"Data: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 75)
    
    transport = ssh_connect()
    print("✅ SSH conectado!\n")
    
    # 1. PING
    print("═" * 75)
    print(f"{'ALVO':<25} {'DESTINO':<20} {'IP RESOLVIDO':<18} {'AVG':>5} {'LOSS':>5} {'MIN':>5} {'MAX':>5} STATUS")
    print("─" * 75)
    
    results = []
    for t in TARGETS:
        output = ssh_exec(transport, f'/ping {t["ip"]} count=5', timeout=15)
        p = parse_ping(output)
        
        resolved = p.get('resolved_ip', '--')
        status = '✅' if p.get('loss', 100) == 0 else '⚠️' if p.get('loss', 100) < 100 else '❌'
        
        print(f"{t['name']:<25} {t['ip']:<20} {resolved:<18} {p.get('avg',0):>4}ms {p.get('loss',0):>4}% {p.get('min',0):>4}ms {p.get('max',0):>4}ms {status}")
        
        results.append({**t, **p})
        time.sleep(0.2)
    
    # 2. Traceroutes
    print("\n" + "═" * 75)
    print("TRACEROUTE — Rotas principais")
    print("═" * 75)
    
    for name, ip in [('Google', 'google.com'), ('Cloudflare', '1.1.1.1'), 
                      ('IX-BR SP', '187.16.222.6'), ('Facebook', 'facebook.com'),
                      ('Netflix', 'netflix.com')]:
        print(f"\n── {name} ──")
        output = ssh_exec(transport, f'/tool traceroute {ip} count=1', timeout=30)
        hops = parse_traceroute(output)
        for h in hops:
            loss_mark = f" ⚠️{h['loss']}%" if h['loss'] > 0 else ""
            print(f"  {h['hop']:2d}. {h['addr']:<22} {h['avg']:>7.1f}ms{loss_mark}")
        time.sleep(0.3)
    
    # 3. Resumo
    print("\n" + "═" * 75)
    print("RESUMO EXECUTIVO")
    print("═" * 75)
    
    ok = [r for r in results if r.get('loss', 100) == 0]
    fail = [r for r in results if r.get('loss', 100) == 100]
    partial = [r for r in results if 0 < r.get('loss', 100) < 100]
    
    print(f"  ✅ Acessíveis: {len(ok)}/{len(results)}")
    if partial: print(f"  ⚠️  Perda parcial: {len(partial)}")
    print(f"  ❌ Inacessíveis: {len(fail)}/{len(results)}")
    
    if ok:
        avg = sum(r.get('avg', 0) for r in ok) / len(ok)
        print(f"  Latência média: {avg:.1f}ms")
    
    if fail:
        print(f"\n  ❌ Serviços inacessíveis:")
        for f in fail:
            print(f"    {f['name']:<25} {f['ip']:<20} (ICMP bloqueado ou indisponível)")
    
    transport.close()
    print(f"\n✅ Concluído: {datetime.now().strftime('%H:%M:%S')}")

if __name__ == '__main__':
    main()
