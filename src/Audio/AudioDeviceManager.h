#pragma once
#import <Foundation/Foundation.h>
#import <AudioToolbox/AudioToolbox.h>
#import <CoreAudio/CoreAudio.h>
#include <vector>
#include <string>
#include "SPLEngine.h"

struct DeviceInfo {
    AudioDeviceID deviceID;
    std::string uid;
    std::string name;
    int inputChannels;
    double sampleRate;
    bool isDefault;
};

@interface AudioDeviceManager : NSObject {
    AudioQueueRef audioQueue;
    AudioQueueBufferRef audioBuffers[4];
    SPLEngine* splEngine;
    BOOL isRunning;
    std::string currentDeviceUID;
    int currentChannel;
    double currentSampleRate;
    int currentChannelCount;
}

- (instancetype)initWithSPLEngine:(SPLEngine*)engine;
- (std::vector<DeviceInfo>)getAvailableInputDevices;
- (BOOL)startWithDeviceUID:(const std::string&)deviceUID channel:(int)channel;
- (void)stop;
- (BOOL)isRunning;
- (std::string)getCurrentDeviceUID;
- (int)getCurrentChannel;
- (double)getCurrentSampleRate;
- (SPLEngine*)getEngine;
- (int)getChannelCount;

@end
