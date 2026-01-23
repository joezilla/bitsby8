; hello.asm - Minimal bootable "Hi" for Altair 8800
;
; This is a minimal example that boots from the FDC+ and prints "Hi"
; to the serial console via the 2SIO board.
;
; Assemble with any 8080 assembler, e.g.:
;   asm8080 hello.asm -o hello.hex
;
; The pre-assembled hello.hex file is provided for convenience.

        ORG     0000h

; Altair 8800 2SIO ports
SIO_STATUS  EQU 00h         ; Status register
SIO_DATA    EQU 01h         ; Data register
TX_READY    EQU 02h         ; Bit 1 = transmit buffer empty

; ============================================
; Entry point - loaded at 0000h by boot ROM
; ============================================
START:
        LXI     SP, 0FFFFh      ; Set stack to top of memory

        ; Print the message
        LXI     H, MSG          ; Point HL to message string
LOOP:
        MOV     A, M            ; Get character from string
        ORA     A               ; Test for null terminator
        JZ      DONE            ; If zero, we're done
        CALL    PUTCHAR         ; Print the character
        INX     H               ; Advance to next character
        JMP     LOOP            ; Continue printing

DONE:
        HLT                     ; Halt the CPU
        JMP     DONE            ; Loop here if restarted

; ============================================
; PUTCHAR - Output character in A to serial
; Waits for transmit buffer to be ready
; ============================================
PUTCHAR:
        PUSH    PSW             ; Save A register and flags
WAIT:
        IN      SIO_STATUS      ; Read 2SIO status register
        ANI     TX_READY        ; Test transmit ready bit
        JZ      WAIT            ; Wait until ready
        POP     PSW             ; Restore A register
        OUT     SIO_DATA        ; Send character to serial port
        RET

; ============================================
; Message string - null terminated
; ============================================
MSG:
        DB      'Hi', 0Dh, 0Ah, 0    ; "Hi" + CR + LF + null

        END     START
