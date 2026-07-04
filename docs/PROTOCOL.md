# FDC+ Serial Drive Communications Protocol

Authoritative wire-protocol spec from Mike Douglas / DerAmp. Kept here
as reference material — the runtime implementation lives in `src/protocol.ts`
and the HTTP surface is documented in `openapi.json`.

```
;***************************************************************************************
;
;  FDC+ Serial Drive Communications Protocol
;
;      Version     Date      Author         Comments
;        1.0     3/05/15    M. Douglas	Original version
;
;-------------------------------------------------------------------------------------
;
;  Communication with the server is over a serial port at 403.2K Baud, 8N1.
;  All transactions are initiated by the FDC. The second choice for baud rate
;  is 460.8K. Finally, 230.4K is the most likely supported baud rate on the PC
;  if 403.2K and 460.8K aren't avaialable.
;
;  403.2K is the preferred rate as it allows full-speed operation and is the
;  most accurate of the three baud rate choices on the FDC. 460.8K also allows
;  full speed operation, but the baud rate is off by about 3.5%. This works, but
;  is borderline. 230.4K is available on most all serial ports, is within 2% of
;  the FDC baud rate, but runs at 80%-90% of real disk speed.
;
;  FDC TO SERVER COMMANDS
;    Commands from the FDC to the server are fixed length, ten byte messages. The
;    first four bytes are a command in ASCII, the remaining six bytes are grouped
;    as three 16 bit words (little endian). The checksum is the 16 bit sum of the
;    first eight bytes of the message.
;
;    Bytes 0-3   Bytes 4-5 as Word   Bytes 6-7 as Word   Bytes 8-9 as Word
;    ---------   -----------------   -----------------   -----------------
;     Command       Parameter 1         Parameter 2           Checksum
;
;    Commands:
;      STAT - Provide and request drive status. The FDC sends the selected drive
;             number and head load status in Parameter 1 and the current track
;             number in Parameter 2. The Server responds with drive mount status
;             (see below). The LSB of Parameter 1 contains the currently selected
;             drive number or 0xff is no drive is selected. The MSB of parameter 1
;             is non-zero if the head is loaded, zero if not loaded.
;
;             The FDC issues the STAT command about ten times per second so that
;             head status and track number information is updated quickly. The
;             server should also assume the drive is selected, the head is loaded,
;             and update the track info whenever a READ or WRIT command is received.
;
;      READ - Read specified track. Parameter 1 contains the drive number in the
;             MSNibble. The lower 12 bits contain the track number. Transfer length
;             length is in Parameter 2 and must be the track length. Also see
;             "Transfer of Track Data" below.
;
;      WRIT - Write specified track. Parameter 1 contains the drive number in the
;             MSNibble. The lower 12 bits contain the track number. Transfer length
;             must be track length. Server responds with WRIT response when ready
;             for the FDC to send the track of data. See "Transfer of Track Data" below.
;
;
;  SERVER TO FDC
;    Reponses from the server to the FDC are fixed length, ten byte messages. The
;    first four bytes are a response command in ASCII, the remaining six bytes are
;    grouped as three 16 bit words (little endian). The checksum is the 16 bit sum
;    of the first eight bytes of the message.
;
;    Bytes 0-3   Bytes 4-5 as Word   Bytes 6-7 as Word   Bytes 8-9 as Word
;    ---------   -----------------   -----------------   -----------------
;     Command      Response Code        Reponse Data          Checksum
;
;    Commands:
;      STAT - Returns drive status in Response Data with one bit per drive. "1" means a
;             drive image is mounted, "0" means not mounted. Bits 15-0 correspond to
;             drive numbers 15-0. Response code is ignored by the FDC.
;
;      WRIT - Issued in repsonse to a WRIT command from the FDC. This response is
;             used to tell the FDC that the server is ready to accept continuous transfer
;             of a full track of data (response code word set to "OK." If the request
;             can't be fulfilled (e.g., specified drive not mounted), the reponse code
;             is set to NOT READY. The Response Data word is don't care.
;
;      WSTA - Final status of the write command after receiving the track data is returned
;             in the repsonse code field. The Response Data word is don't care.
;
;    Reponse Code:
;      0x0000 - OK
;      0x0001 - Not Ready (e.g., write request to unmounted drive)
;      0x0002 - Checksum error (e.g., on the block of write data)
;      0x0003 - Write error (e.g., write to disk failed)
;
;
;  TRANSFER OF TRACK DATA
;    Track data is sent as a sequence of bytes followed by a 16 bit, little endian
;    checksum. Note the Transfer Length field does NOT include the two bytes of
;    the checksum. The following notes apply to both the FDC and the server.
;
;  ERROR RECOVERY
;    The FDC uses a timeout of one second after the last byte of a message or data block
;        is sent to determine if a transmission was ignored.
;
;    The server should ignore commands with an invalid checksum. The FDC may retry the
;        command if no response is received. An invalid checksum on a block of write
;        data should not be ignored, instead, the WRIT response should have the
;        Reponse Code field set to 0x002, checksum error.
;
;    The FDC ignores responses with an invalid checksum. The FDC may retry the command
;        that generated the response by sending the command again.
;
;***************************************************************************************
```
