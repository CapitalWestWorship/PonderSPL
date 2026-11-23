#pragma once
#import <Foundation/Foundation.h>
#import <IOKit/pwr_mgt/IOPMLib.h>
#include <fstream>
#include <string>
#include <mutex>
#include <thread>
#include <atomic>
#include "SPLEngine.h"

struct LogStatus {
    bool isLogging = false;
    bool isPaused = false;
    uint64_t recordCount = 0;
    double elapsedSeconds = 0.0;
    std::string currentFilePath = "";
    int intervalMs = 1000;
    std::string format = "csv"; // "csv" or "txt"
    bool preventSleep = false;
};

@interface CSVLogger : NSObject {
    SPLEngine* splEngine;
    std::ofstream logFile;
    std::mutex fileMutex;
    std::thread logThread;
    std::atomic<bool> isRunning;
    std::atomic<bool> isPaused;
    std::atomic<int> sampleIntervalMs;
    std::atomic<uint64_t> recordCount;
    std::chrono::time_point<std::chrono::steady_clock> startTime;
    std::string currentPath;
    std::string baseDirectory;
    std::string logFormat; // "csv" or "txt"
    bool preventSleepDuringLogging;
    IOPMAssertionID sleepAssertionID;
    bool hasSleepAssertion;
}

- (instancetype)initWithSPLEngine:(SPLEngine*)engine;
- (BOOL)startLoggingWithDirectory:(const std::string&)dir
                       intervalMs:(int)intervalMs
                           format:(const std::string&)format
                        eventName:(const std::string&)eventName
                     preventSleep:(BOOL)preventSleep;
- (void)pauseLogging;
- (void)resumeLogging;
- (void)stopLogging;
- (LogStatus)getStatus;
- (void)revealInFinder;
- (std::string)getDefaultLogDirectory;

@end
