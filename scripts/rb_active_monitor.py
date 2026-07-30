#!/usr/bin/env python3
"""
OTIA — Sistema de Medição Ativa via SSH na RB Cliente
RB: TESTE-BANDA-WELLINHO (143.137.32.232:224)
"""

import paramiko
import warnings
import json
import time
import re
import statistics
from datetime import datetime

warnings.filterwarnings('ignore')

RB_HOST = '143.137.32.232'
RB_PORT = 224
RB_USER = 'otia'
RB_PASS = 'Arr0b@2019Bl'

PING_TARGETS = [
    {'name': 'Gateway-MX204-SR', 'ip': '143.137.32.4', 'role': 'gateway'},
    {'name': 'Google-DNS', 'ip': '8.8.8.8', 'role': 'internet'},
    {'name': 'Cloudflare-DNS', 'ip': '1.1.1.1', 'role': 'internet'},
    {'name': 'CCR-Centro', 'ip': '143.137.32.7', 'role': 'core'},
    {'name': 'IX-BR-SP', 'ip': '187.16.222.6', 'role': 'ix'},
]

HISTORY_FILE = '/tmp/otia_rb_history.json'

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

def parse_ping(output):
    result = {'rtts': []}
    for line in output.split('\n'):
        if 'TIME' in line:
            match = re.search(r'(\d+)ms', line.split('TIME')[-1])
            if match:
                result['rtts'].append(int(match.group(1)))
    
    summary = re.search(
        r'sent=(\d+)\s+received=(\d+)\s+packet-loss=(\d+)%\s+min-rtt=(\d+)ms\s+avg-rtt=(\d+)ms\s+max-rtt=(\d+)ms',
        output
    )
    if summary:
        result.update({
            'sent': int(summary.group(1)),
            'received': int(summary.group(2)),
            'packetLoss': int(summary.group(3)),
            'minRtt': int(summary.group(4)),
            'avgRtt': int(summary.group(5)),
            'maxRtt': int(summary.group(6)),
        })
        if len(result['rtts']) >= 2:
            result['jitter'] = round(statistics.stdev(result['rtts']), 2)
        else:
            result['jitter'] = 0
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
                'address': match.group(2),
                'loss': int(match.group(3)),
                'last': float(match.group(5)),
                'avg': float(match.group(6)),
                'best': float(match.group(7)),
                'worst': float(match.group(8)),
            })
    return hops

def run_ping_suite(transport):
    results = []
    for target in PING_TARGETS:
        output = ssh_exec(transport, f'/ping {target["ip"]} count=10')
        parsed = parse_ping(output)
        parsed['target'] = target
        parsed['timestamp'] = datetime.now().isoformat()
        results.append(parsed)
        
        if parsed.get('packetLoss', 0) > 0:
            print(f"  ⚠️  {target['name']} ({target['ip']}): {parsed['packetLoss']}% perda!")
        if parsed.get('avgRtt', 0) > 100:
            print(f"  ⚠️  {target['name']} ({target['ip']}): {parsed['avgRtt']}ms latência alta!")
        if parsed.get('jitter', 0) > 10:
            print(f"  ⚠️  {target['name']} ({target['ip']}): {parsed['jitter']}ms jitter!")
    
    return results

def run_traceroute(transport, target='8.8.8.8'):
    output = ssh_exec(transport, f'/tool traceroute {target} count=1')
    hops = parse_traceroute(output)
    
    print(f"\n  Traceroute para {target}:")
    for hop in hops:
        print(f"    {hop['hop']:2d}. {hop['address']:20s} {hop['avg']}ms (loss: {hop['loss']}%)")
        if hop['loss'] > 0:
            print(f"        ⚠️ Perda no hop {hop['hop']}!")
    
    return hops

def get_system_status(transport):
    resource = ssh_exec(transport, 'system resource print')
    identity = ssh_exec(transport, 'system identity print')
    
    status = {'timestamp': datetime.now().isoformat()}
    for line in resource.split('\n'):
        if 'uptime:' in line:
            status['uptime'] = line.split('uptime:')[1].strip()
        elif 'cpu-load:' in line:
            status['cpuLoad'] = line.split('cpu-load:')[1].strip()
        elif 'free-memory:' in line:
            status['freeMemory'] = line.split('free-memory:')[1].strip()
        elif 'total-memory:' in line:
            status['totalMemory'] = line.split('total-memory:')[1].strip()
        elif 'version:' in line:
            status['version'] = line.split('version:')[1].strip()
    
    # Name
    name_match = re.search(r'name:\s*(.+)', identity)
    if name_match:
        status['name'] = name_match.group(1).strip()
    
    # Alertas
    cpu_match = re.search(r'(\d+)', status.get('cpuLoad', '0'))
    cpu = int(cpu_match.group(1)) if cpu_match else 0
    if cpu > 80:
        print(f"  🔴 CRÍTICO: CPU em {cpu}%!")
    elif cpu > 60:
        print(f"  ⚠️  ATENÇÃO: CPU em {cpu}%")
    
    return status

def save_history(data):
    try:
        with open(HISTORY_FILE, 'r') as f:
            history = json.load(f)
    except:
        history = []
    history.append(data)
    if len(history) > 1000:
        history = history[-1000:]
    with open(HISTORY_FILE, 'w') as f:
        json.dump(history, f)

def main():
    print("=" * 60)
    print("OTIA — NOC Preditivo — Medição Ativa RB Cliente")
    print(f"RB: {RB_HOST}:{RB_PORT} | {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)
    
    try:
        transport = ssh_connect()
        print("✅ SSH conectado!\n")
        
        # 1. Status
        print("--- STATUS DO SISTEMA ---")
        status = get_system_status(transport)
        for k, v in status.items():
            print(f"  {k}: {v}")
        
        # 2. Pings
        print("\n--- MEDIÇÃO DE LATÊNCIA (10 pings por alvo) ---")
        ping_results = run_ping_suite(transport)
        print()
        for r in ping_results:
            t = r['target']
            print(f"  {t['name']:25s} ({t['ip']:15s}) "
                  f"avg={r.get('avgRtt',0)}ms "
                  f"loss={r.get('packetLoss',0)}% "
                  f"jitter={r.get('jitter',0)}ms "
                  f"min={r.get('minRtt',0)} max={r.get('maxRtt',0)}")
        
        # 3. Traceroute
        print("\n--- TRACEROUTE ---")
        hops = run_traceroute(transport, '8.8.8.8')
        
        # 4. Salvar
        measurement = {
            'timestamp': datetime.now().isoformat(),
            'status': status,
            'pings': [{k: v for k, v in r.items() if k != 'rtts'} for r in ping_results],
            'traceroute': hops,
        }
        save_history(measurement)
        
        # 5. Análise preditiva
        try:
            with open(HISTORY_FILE, 'r') as f:
                history = json.load(f)
            print(f"\n--- HISTÓRICO ---")
            print(f"  Medições acumuladas: {len(history)}")
        except:
            pass
        
        transport.close()
        print("\n✅ Medição concluída com sucesso!")
        
    except Exception as e:
        print(f"\n❌ Erro: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    main()
