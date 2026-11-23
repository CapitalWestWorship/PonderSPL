#import "AudioDeviceManager.h"
#import <iostream>

static void AudioInputCallback(void *inUserData,
                               AudioQueueRef inAQ,
                               AudioQueueBufferRef inBuffer,
                               const AudioTimeStamp *inStartTime,
                               UInt32 inNumPackets,
                               const AudioStreamPacketDescription *inPacketDesc) {
    AudioDeviceManager *manager = (__bridge AudioDeviceManager *)inUserData;
    if (!manager || ![manager isRunning]) return;

    SPLEngine *engine = [manager getEngine];
    if (engine && inBuffer->mAudioDataByteSize > 0) {
        int channels = [manager getChannelCount];
        UInt32 numFrames = inBuffer->mAudioDataByteSize / (sizeof(float) * channels);
        engine->processAudioInterleaved((const float *)inBuffer->mAudioData, numFrames, channels);
    }

    AudioQueueEnqueueBuffer(inAQ, inBuffer, 0, NULL);
}

@implementation AudioDeviceManager

- (instancetype)initWithSPLEngine:(SPLEngine*)engine {
    self = [super init];
    if (self) {
        splEngine = engine;
        audioQueue = NULL;
        isRunning = NO;
        currentDeviceUID = "";
        currentChannel = 0;
        currentSampleRate = 48000.0;
        currentChannelCount = 1;
    }
    return self;
}

- (void)dealloc {
    [self stop];
}

- (SPLEngine*)getEngine {
    return splEngine;
}

- (int)getChannelCount {
    return currentChannelCount;
}

- (BOOL)isRunning {
    return isRunning;
}

- (std::string)getCurrentDeviceUID {
    return currentDeviceUID;
}

- (int)getCurrentChannel {
    return currentChannel;
}

- (double)getCurrentSampleRate {
    return currentSampleRate;
}

- (std::vector<DeviceInfo>)getAvailableInputDevices {
    std::vector<DeviceInfo> result;

    AudioObjectPropertyAddress propertyAddress = {
        kAudioHardwarePropertyDevices,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };

    UInt32 dataSize = 0;
    OSStatus status = AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &propertyAddress, 0, NULL, &dataSize);
    if (status != noErr || dataSize == 0) return result;

    UInt32 deviceCount = dataSize / sizeof(AudioDeviceID);
    std::vector<AudioDeviceID> devices(deviceCount);
    status = AudioObjectGetPropertyData(kAudioObjectSystemObject, &propertyAddress, 0, NULL, &dataSize, devices.data());
    if (status != noErr) return result;

    // Get default input device
    AudioDeviceID defaultDeviceID = 0;
    UInt32 defaultSize = sizeof(AudioDeviceID);
    AudioObjectPropertyAddress defaultAddress = {
        kAudioHardwarePropertyDefaultInputDevice,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    AudioObjectGetPropertyData(kAudioObjectSystemObject, &defaultAddress, 0, NULL, &defaultSize, &defaultDeviceID);

    for (UInt32 i = 0; i < deviceCount; ++i) {
        AudioDeviceID devId = devices[i];

        // Check if device has input streams
        AudioObjectPropertyAddress streamsAddress = {
            kAudioDevicePropertyStreams,
            kAudioObjectPropertyScopeInput,
            kAudioObjectPropertyElementMain
        };
        UInt32 streamsSize = 0;
        AudioObjectGetPropertyDataSize(devId, &streamsAddress, 0, NULL, &streamsSize);
        if (streamsSize == 0) continue; // Output only

        // Count total input channels
        AudioObjectPropertyAddress configAddress = {
            kAudioDevicePropertyStreamConfiguration,
            kAudioObjectPropertyScopeInput,
            kAudioObjectPropertyElementMain
        };
        UInt32 configSize = 0;
        AudioObjectGetPropertyDataSize(devId, &configAddress, 0, NULL, &configSize);
        int totalChannels = 0;
        if (configSize > 0) {
            AudioBufferList *bufferList = (AudioBufferList *)malloc(configSize);
            if (AudioObjectGetPropertyData(devId, &configAddress, 0, NULL, &configSize, bufferList) == noErr) {
                for (UInt32 b = 0; b < bufferList->mNumberBuffers; ++b) {
                    totalChannels += bufferList->mBuffers[b].mNumberChannels;
                }
            }
            free(bufferList);
        }
        if (totalChannels == 0) continue;

        // Get Name
        CFStringRef nameRef = NULL;
        UInt32 nameSize = sizeof(CFStringRef);
        AudioObjectPropertyAddress nameAddress = {
            kAudioObjectPropertyName,
            kAudioObjectPropertyScopeGlobal,
            kAudioObjectPropertyElementMain
        };
        AudioObjectGetPropertyData(devId, &nameAddress, 0, NULL, &nameSize, &nameRef);
        std::string nameStr = nameRef ? [(__bridge NSString *)nameRef UTF8String] : "Unknown Audio Input";
        if (nameRef) CFRelease(nameRef);

        // Get UID
        CFStringRef uidRef = NULL;
        UInt32 uidSize = sizeof(CFStringRef);
        AudioObjectPropertyAddress uidAddress = {
            kAudioDevicePropertyDeviceUID,
            kAudioObjectPropertyScopeGlobal,
            kAudioObjectPropertyElementMain
        };
        AudioObjectGetPropertyData(devId, &uidAddress, 0, NULL, &uidSize, &uidRef);
        std::string uidStr = uidRef ? [(__bridge NSString *)uidRef UTF8String] : "";
        if (uidRef) CFRelease(uidRef);

        // Get Sample Rate
        Float64 devSampleRate = 48000.0;
        UInt32 srSize = sizeof(Float64);
        AudioObjectPropertyAddress srAddress = {
            kAudioDevicePropertyNominalSampleRate,
            kAudioObjectPropertyScopeGlobal,
            kAudioObjectPropertyElementMain
        };
        AudioObjectGetPropertyData(devId, &srAddress, 0, NULL, &srSize, &devSampleRate);

        DeviceInfo info;
        info.deviceID = devId;
        info.uid = uidStr;
        info.name = nameStr;
        info.inputChannels = totalChannels;
        info.sampleRate = devSampleRate;
        info.isDefault = (devId == defaultDeviceID);

        result.push_back(info);
    }

    return result;
}

- (BOOL)startWithDeviceUID:(const std::string&)deviceUID channel:(int)channel {
    [self stop];

    auto devices = [self getAvailableInputDevices];
    if (devices.empty()) {
        NSLog(@"[AudioDeviceManager] No input devices found.");
        return NO;
    }

    DeviceInfo selectedInfo = devices[0];
    bool found = false;
    if (!deviceUID.empty()) {
        for (const auto& dev : devices) {
            if (dev.uid == deviceUID) {
                selectedInfo = dev;
                found = true;
                break;
            }
        }
    }
    if (!found) {
        // Pick default device if possible
        for (const auto& dev : devices) {
            if (dev.isDefault) {
                selectedInfo = dev;
                break;
            }
        }
    }

    currentDeviceUID = selectedInfo.uid;
    currentChannel = channel;
    currentSampleRate = selectedInfo.sampleRate > 0.0 ? selectedInfo.sampleRate : 48000.0;
    currentChannelCount = std::min(std::max(selectedInfo.inputChannels, 1), 8);

    if (splEngine) {
        splEngine->setSampleRate(currentSampleRate);
        splEngine->setChannel(channel);
    }

    AudioStreamBasicDescription format;
    memset(&format, 0, sizeof(format));
    format.mSampleRate = currentSampleRate;
    format.mFormatID = kAudioFormatLinearPCM;
    format.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked;
    format.mFramesPerPacket = 1;
    format.mChannelsPerFrame = currentChannelCount;
    format.mBitsPerChannel = 32;
    format.mBytesPerPacket = sizeof(float) * currentChannelCount;
    format.mBytesPerFrame = sizeof(float) * currentChannelCount;

    OSStatus status = AudioQueueNewInput(&format, AudioInputCallback, (__bridge void *)self, NULL, NULL, 0, &audioQueue);
    if (status != noErr) {
        NSLog(@"[AudioDeviceManager] AudioQueueNewInput failed: %d", (int)status);
        return NO;
    }

    // Set Device UID on AudioQueue
    CFStringRef cfUID = CFStringCreateWithCString(kCFAllocatorDefault, currentDeviceUID.c_str(), kCFStringEncodingUTF8);
    if (cfUID) {
        AudioQueueSetProperty(audioQueue, kAudioQueueProperty_CurrentDevice, &cfUID, sizeof(cfUID));
        CFRelease(cfUID);
    }

    // Allocate 4 audio buffers of 1024 frames each
    UInt32 bufferByteSize = 1024 * format.mBytesPerFrame;
    for (int i = 0; i < 4; ++i) {
        status = AudioQueueAllocateBuffer(audioQueue, bufferByteSize, &audioBuffers[i]);
        if (status == noErr) {
            AudioQueueEnqueueBuffer(audioQueue, audioBuffers[i], 0, NULL);
        }
    }

    status = AudioQueueStart(audioQueue, NULL);
    if (status != noErr) {
        NSLog(@"[AudioDeviceManager] AudioQueueStart failed: %d", (int)status);
        [self stop];
        return NO;
    }

    isRunning = YES;
    NSLog(@"[AudioDeviceManager] Started capturing from '%s' (%d ch, %.1f Hz)",
          selectedInfo.name.c_str(), currentChannelCount, currentSampleRate);
    return YES;
}

- (void)stop {
    if (audioQueue) {
        isRunning = NO;
        AudioQueueStop(audioQueue, true);
        AudioQueueDispose(audioQueue, true);
        audioQueue = NULL;
    }
}

@end
