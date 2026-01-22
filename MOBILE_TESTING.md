# 📱 Testing on Your Phone

## Quick Setup

### Step 1: Find Your Computer's IP Address

**On Mac:**
```bash
# Option 1: Using System Preferences
# Go to System Preferences → Network → Wi-Fi → Advanced → TCP/IP
# Look for "IPv4 Address"

# Option 2: Using Terminal
ipconfig getifaddr en0
# or
ipconfig getifaddr en1
```

**Or check manually:**
1. Open **System Preferences** → **Network**
2. Select **Wi-Fi** (or Ethernet)
3. Your IP address is shown (e.g., `192.168.1.100`)

### Step 2: Start Server for Mobile Access

**Stop the current server** (if running) by pressing `Ctrl+C` in the terminal.

Then start it with mobile access enabled:

```bash
npm run dev:mobile
```

Or manually:
```bash
next dev -H 0.0.0.0
```

You should see:
```
▲ Next.js 15.x.x
- Local:        http://localhost:3000
- Network:      http://192.168.1.XXX:3000
```

### Step 3: Connect Your Phone

1. **Make sure your phone is on the same Wi-Fi network** as your computer
2. **Open your phone's browser** (Chrome, Safari, etc.)
3. **Type in the address bar:**
   ```
   http://YOUR_IP_ADDRESS:3000
   ```
   
   For example: `http://192.168.1.100:3000`

4. You should see the treasure hunt landing page!

## Testing Features on Phone

### ✅ QR Code Scanner
- Works best on phone cameras
- Grant camera permissions when prompted
- Point at QR code to scan

### ✅ GPS Detection
- Works better on real devices
- Grant location permissions
- Test outdoors for better accuracy

### ✅ Manual Code Entry
- Works on any device
- Type codes found at locations

## Troubleshooting

**Can't connect from phone:**
- ✅ Make sure both devices are on the same Wi-Fi
- ✅ Check firewall isn't blocking port 3000
- ✅ Try turning off VPN if you have one
- ✅ Make sure server shows "Network: http://..." when you start it

**QR Scanner not working:**
- ✅ Grant camera permissions in browser
- ✅ Use HTTPS in production (required for camera)
- ✅ Test in Chrome or Safari (best support)

**GPS not working:**
- ✅ Grant location permissions
- ✅ Test outdoors for better signal
- ✅ Make sure location services are enabled

**Firewall blocking:**
If your Mac firewall blocks the connection:
1. Go to **System Preferences** → **Security & Privacy** → **Firewall**
2. Click **Firewall Options**
3. Make sure Node.js or Terminal is allowed

Or temporarily disable firewall for testing.

## Alternative: Use ngrok (For Testing Outside Your Network)

If you want to test from anywhere (not just same Wi-Fi):

1. Install ngrok: https://ngrok.com/download
2. Run:
   ```bash
   ngrok http 3000
   ```
3. Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)
4. Access from any device, anywhere!

## 🎯 Quick Test Checklist

- [ ] Server running with `npm run dev:mobile`
- [ ] Found your IP address
- [ ] Phone on same Wi-Fi network
- [ ] Can access app from phone browser
- [ ] QR scanner works (camera permission granted)
- [ ] GPS works (location permission granted)
- [ ] Can join as a team
- [ ] Can unlock checkpoints

## 💡 Pro Tips

- **Use HTTPS in production** - Required for camera/location on most browsers
- **Test all unlock methods** - QR, GPS, and manual codes
- **Test with multiple phones** - Simulate multiple teams
- **Check leaderboard updates** - Make sure real-time updates work

You're all set! 🚀
