#!/usr/bin/env node
"use strict";
/**
 * Simple FDC+ Server - Console logging only (no terminal UI)
 * For debugging when terminal UI has issues
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const serialport_1 = require("serialport");
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const serialPath = process.argv[2] || '/dev/cu.usbserial-FTE90ZVP';
const baudRate = parseInt(process.argv[3]) || 460800;
const diskImage = process.argv[4];
console.log('=== FDC+ Simple Server ===');
console.log(`Serial: ${serialPath}`);
console.log(`Baud: ${baudRate}`);
console.log(`Disk: ${diskImage || 'none'}`);
console.log('');
let serialPort;
let diskFile = null;
let diskSize = 0;
// Track state
let mountedDrives = 0; // Bitmask of mounted drives
async function main() {
    try {
        // Open disk image if provided
        if (diskImage) {
            diskFile = await fs.open(diskImage, 'r');
            const stats = await diskFile.stat();
            diskSize = stats.size;
            console.log(`✅ Disk mounted: ${path.basename(diskImage)} (${diskSize} bytes)`);
            mountedDrives |= 0x01; // Drive 0 mounted
        }
        // Open serial port
        serialPort = new serialport_1.SerialPort({
            path: serialPath,
            baudRate: baudRate,
            dataBits: 8,
            stopBits: 1,
            parity: 'none',
            rtscts: false,
            xon: false,
            xoff: false,
            xany: false,
            lock: false,
        });
        serialPort.on('open', () => {
            console.log('✅ Serial port opened\n');
            console.log('Waiting for commands...\n');
        });
        serialPort.on('error', (err) => {
            console.error('❌ Serial error:', err.message);
            process.exit(1);
        });
        // Process incoming data
        let buffer = Buffer.alloc(0);
        serialPort.on('data', async (data) => {
            buffer = Buffer.concat([buffer, data]);
            // Need at least 10 bytes for command (8 data + 2 checksum)
            while (buffer.length >= 10) {
                const cmdData = buffer.slice(0, 8);
                const checksumBytes = buffer.slice(8, 10);
                buffer = buffer.slice(10);
                // Verify checksum
                let calcChecksum = 0;
                for (let i = 0; i < 8; i++) {
                    calcChecksum += cmdData[i];
                }
                calcChecksum &= 0xffff;
                const recvChecksum = checksumBytes[0] | (checksumBytes[1] << 8);
                if (calcChecksum !== recvChecksum) {
                    console.error(`❌ Checksum error: calc=0x${calcChecksum.toString(16)}, recv=0x${recvChecksum.toString(16)}`);
                    continue;
                }
                // Parse command
                const cmd = cmdData.toString('ascii', 0, 4);
                const param1 = cmdData.readUInt16LE(4);
                const param2 = cmdData.readUInt16LE(6);
                console.log(`📨 ${cmd} p1=0x${param1.toString(16).padStart(4, '0')} p2=0x${param2.toString(16).padStart(4, '0')}`);
                // Handle command
                try {
                    await handleCommand(cmd, param1, param2);
                }
                catch (error) {
                    console.error(`❌ Command error:`, error);
                }
            }
        });
        // Keep running
        console.log('Press Ctrl+C to exit...\n');
    }
    catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
}
async function handleCommand(cmd, param1, param2) {
    if (cmd === 'STAT') {
        // STAT: param1 = LSB:drive MSB:head, param2 = track
        const drive = param1 & 0xff;
        const headLoad = (param1 >> 8) & 0xff;
        const track = param2;
        console.log(`  → STAT: drive=${drive}, head=${headLoad}, track=${track}`);
        // Send response with mounted drives status
        const response = Buffer.alloc(10);
        response.write('STAT', 0, 4, 'ascii');
        response.writeUInt16LE(param1, 4); // Echo param1
        response.writeUInt16LE(mountedDrives, 6); // Status: which drives mounted
        // Calculate checksum
        let checksum = 0;
        for (let i = 0; i < 8; i++) {
            checksum += response[i];
        }
        response.writeUInt16LE(checksum & 0xffff, 8);
        console.log(`  ← Response: ${response.toString('hex')} (status=0x${mountedDrives.toString(16)})`);
        serialPort.write(response);
        await new Promise(resolve => serialPort.drain(resolve));
    }
    else if (cmd === 'READ') {
        // READ: param1 = bits 0-11:track bits 12-15:drive, param2 = length
        const drive = (param1 >> 12) & 0x0f;
        const track = param1 & 0x0fff;
        const length = param2;
        console.log(`  → READ: drive=${drive}, track=${track}, length=${length}`);
        if (!diskFile || drive !== 0) {
            console.error(`  ❌ Disk not mounted or wrong drive`);
            // Send error response
            const response = Buffer.alloc(10);
            response.write('READ', 0, 4, 'ascii');
            response.writeUInt16LE(param1, 4);
            response.writeUInt16LE(0x01, 6); // NOT_READY error
            let checksum = 0;
            for (let i = 0; i < 8; i++) {
                checksum += response[i];
            }
            response.writeUInt16LE(checksum & 0xffff, 8);
            serialPort.write(response);
            await new Promise(resolve => serialPort.drain(resolve));
            return;
        }
        // Read track data
        const offset = track * length;
        const trackData = Buffer.alloc(length);
        try {
            await diskFile.read(trackData, 0, length, offset);
            // Send ONLY track data with checksum (NO response header!)
            let dataChecksum = 0;
            for (let i = 0; i < length; i++) {
                dataChecksum += trackData[i];
            }
            dataChecksum &= 0xffff;
            const dataWithChecksum = Buffer.alloc(length + 2);
            trackData.copy(dataWithChecksum, 0);
            dataWithChecksum.writeUInt16LE(dataChecksum, length);
            serialPort.write(dataWithChecksum);
            await new Promise(resolve => serialPort.drain(resolve));
            console.log(`  ← Sent ${length} bytes + checksum`);
        }
        catch (error) {
            console.error(`  ❌ Read error:`, error);
        }
    }
    else if (cmd === 'WRIT') {
        console.log(`  → WRIT: (not implemented)`);
        // Send error
        const response = Buffer.alloc(10);
        response.write('WRIT', 0, 4, 'ascii');
        response.writeUInt16LE(param1, 4);
        response.writeUInt16LE(0x03, 6); // WRITE_ERR
        let checksum = 0;
        for (let i = 0; i < 8; i++) {
            checksum += response[i];
        }
        response.writeUInt16LE(checksum & 0xffff, 8);
        serialPort.write(response);
        await new Promise(resolve => serialPort.drain(resolve));
    }
    else {
        console.log(`  ❓ Unknown command: ${cmd}`);
    }
}
// Cleanup
process.on('SIGINT', async () => {
    console.log('\n\nShutting down...');
    if (serialPort && serialPort.isOpen) {
        serialPort.close();
    }
    if (diskFile) {
        await diskFile.close();
    }
    process.exit(0);
});
main();
//# sourceMappingURL=simple-server.js.map