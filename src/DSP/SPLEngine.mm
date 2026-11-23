#include "SPLEngine.h"
#include <cmath>
#include <iostream>

static const double RTA_CENTERS[31] = {
    20.0, 25.0, 31.5, 40.0, 50.0, 63.0, 80.0, 100.0, 125.0, 160.0,
    200.0, 250.0, 315.0, 400.0, 500.0, 630.0, 800.0, 1000.0, 1250.0, 1600.0,
    2000.0, 2500.0, 3150.0, 4000.0, 5000.0, 6300.0, 8000.0, 10000.0, 12500.0, 16000.0, 20000.0
};

SPLEngine::SPLEngine() {
    energyRing.resize(RING_SIZE);

    fftSetup = vDSP_create_fftsetup(LOG2_N, kFFTRadix2);
    fftInput.assign(FFT_SIZE, 0.0f);
    fftWindow.assign(FFT_SIZE, 0.0f);
    vDSP_hann_window(fftWindow.data(), FFT_SIZE, vDSP_HANN_NORM);

    fftReal.assign(FFT_SIZE / 2, 0.0f);
    fftImag.assign(FFT_SIZE / 2, 0.0f);
    fftSplit.realp = fftReal.data();
    fftSplit.imagp = fftImag.data();

    updateFilterCoefficients();
}

SPLEngine::~SPLEngine() {
    if (fftSetup) {
        vDSP_destroy_fftsetup(fftSetup);
        fftSetup = nullptr;
    }
}

void SPLEngine::setSampleRate(double fs) {
    std::lock_guard<std::mutex> lock(dspMutex);
    sampleRate = fs;
    updateFilterCoefficients();
    micCal.rebuildFIRFilter(sampleRate);
}

void SPLEngine::updateFilterCoefficients() {
    filterA = IECWeighting::designAWeighting(sampleRate);
    filterC = IECWeighting::designCWeighting(sampleRate);
    filterZ = IECWeighting::designZWeighting(sampleRate);

    alphaFast = 1.0 - std::exp(-1.0 / (sampleRate * 0.125));
    alphaSlow = 1.0 - std::exp(-1.0 / (sampleRate * 1.000));

    sliceTargetSamples = (uint64_t)(sampleRate * 0.100); // 100ms
    if (sliceTargetSamples < 1) sliceTargetSamples = 1;
}

void SPLEngine::setChannel(int channel) {
    std::lock_guard<std::mutex> lock(dspMutex);
    selectedChannel = channel;
}

void SPLEngine::setCalibrationOffset(double offset_dB) {
    std::lock_guard<std::mutex> lock(dspMutex);
    calibrationOffset = offset_dB;
}

double SPLEngine::getCalibrationOffset() const {
    return calibrationOffset;
}

void SPLEngine::calibrateToTarget(double target_dBA) {
    std::lock_guard<std::mutex> lock(dspMutex);
    double currentLAS = 10.0 * std::log10(std::max(powerASlow, 1e-14)) + calibrationOffset;
    double delta = target_dBA - currentLAS;
    calibrationOffset += delta;
}

void SPLEngine::resetStats() {
    std::lock_guard<std::mutex> lock(dspMutex);
    maxLAS = 0.0;
    minLAS = 150.0;
    maxLCS = 0.0;
    maxLZS = 0.0;
    peakC = 0.0;
    peakZ = 0.0;

    cumulativeSumSqA = 0.0;
    cumulativeSumSqC = 0.0;
    cumulativeSumSqZ = 0.0;
    cumulativeCount = 0;

    sliceSumSqA = 0.0;
    sliceSumSqC = 0.0;
    sliceSumSqZ = 0.0;
    sliceSampleCount = 0;

    ringHead = 0;
    ringCount = 0;
    for (auto& s : energyRing) {
        s.sumSqA = 0.0;
        s.sumSqC = 0.0;
        s.sumSqZ = 0.0;
        s.count = 0;
    }
}

bool SPLEngine::loadCalibrationFile(const std::string& path) {
    std::lock_guard<std::mutex> lock(dspMutex);
    return micCal.loadFromFile(path, sampleRate);
}

void SPLEngine::clearCalibrationFile() {
    std::lock_guard<std::mutex> lock(dspMutex);
    micCal.reset();
}

void SPLEngine::setCalibrationEnabled(bool enabled) {
    std::lock_guard<std::mutex> lock(dspMutex);
    micCal.isEnabled = enabled;
}

void SPLEngine::processAudioInterleaved(const float* buffer, UInt32 numFrames, UInt32 numChannels) {
    if (!buffer || numFrames == 0 || numChannels == 0) return;

    std::vector<float> mono(numFrames);

    if (selectedChannel >= 0 && (UInt32)selectedChannel < numChannels) {
        for (UInt32 i = 0; i < numFrames; ++i) {
            mono[i] = buffer[i * numChannels + selectedChannel];
        }
    } else {
        float invCh = 1.0f / (float)numChannels;
        for (UInt32 i = 0; i < numFrames; ++i) {
            float sum = 0.0f;
            for (UInt32 c = 0; c < numChannels; ++c) {
                sum += buffer[i * numChannels + c];
            }
            mono[i] = sum * invCh;
        }
    }

    std::lock_guard<std::mutex> lock(dspMutex);

    std::vector<float> calSignal(numFrames);
    micCal.process(mono.data(), calSignal.data(), numFrames);

    for (UInt32 i = 0; i < numFrames; ++i) {
        float x = calSignal[i];

        float xA = filterA.process(x);
        float xC = filterC.process(x);
        float xZ = filterZ.process(x);

        double xA2 = (double)xA * (double)xA;
        double xC2 = (double)xC * (double)xC;
        double xZ2 = (double)xZ * (double)xZ;

        powerAFast = alphaFast * xA2 + (1.0 - alphaFast) * powerAFast;
        powerASlow = alphaSlow * xA2 + (1.0 - alphaSlow) * powerASlow;

        powerCFast = alphaFast * xC2 + (1.0 - alphaFast) * powerCFast;
        powerCSlow = alphaSlow * xC2 + (1.0 - alphaSlow) * powerCSlow;

        powerZFast = alphaFast * xZ2 + (1.0 - alphaFast) * powerZFast;
        powerZSlow = alphaSlow * xZ2 + (1.0 - alphaSlow) * powerZSlow;

        double absC = std::abs((double)xC);
        double absZ = std::abs((double)xZ);
        if (absC > peakC) peakC = absC;
        if (absZ > peakZ) peakZ = absZ;

        sliceSumSqA += xA2;
        sliceSumSqC += xC2;
        sliceSumSqZ += xZ2;
        sliceSampleCount++;

        cumulativeSumSqA += xA2;
        cumulativeSumSqC += xC2;
        cumulativeSumSqZ += xZ2;
        cumulativeCount++;

        if (sliceSampleCount >= sliceTargetSamples) {
            energyRing[ringHead] = { sliceSumSqA, sliceSumSqC, sliceSumSqZ, sliceSampleCount };
            ringHead = (ringHead + 1) % RING_SIZE;
            if (ringCount < RING_SIZE) ringCount++;

            sliceSumSqA = 0.0;
            sliceSumSqC = 0.0;
            sliceSumSqZ = 0.0;
            sliceSampleCount = 0;
        }
    }

    double peakDecay = std::exp(- (double)numFrames / (sampleRate * 2.0));
    peakC *= peakDecay;
    peakZ *= peakDecay;

    rtaHopCounter += numFrames;
    if (rtaHopCounter >= 1024) {
        rtaHopCounter = 0;
        computeRTA(calSignal.data(), numFrames);
    }
}

void SPLEngine::computeRTA(const float* signal, size_t count) {
    if (count < (size_t)FFT_SIZE) {
        size_t keep = FFT_SIZE - count;
        std::memmove(fftInput.data(), fftInput.data() + count, keep * sizeof(float));
        std::memcpy(fftInput.data() + keep, signal, count * sizeof(float));
    } else {
        std::memcpy(fftInput.data(), signal + (count - FFT_SIZE), FFT_SIZE * sizeof(float));
    }

    std::vector<float> windowed(FFT_SIZE);
    vDSP_vmul(fftInput.data(), 1, fftWindow.data(), 1, windowed.data(), 1, FFT_SIZE);
    vDSP_ctoz((const DSPComplex*)windowed.data(), 2, &fftSplit, 1, FFT_SIZE / 2);
    vDSP_fft_zrip(fftSetup, &fftSplit, 1, LOG2_N, FFT_FORWARD);

    std::vector<float> magSq(FFT_SIZE / 2);
    vDSP_zvmags(&fftSplit, 1, magSq.data(), 1, FFT_SIZE / 2);

    float scale = 1.0f / (float)(FFT_SIZE * FFT_SIZE);
    vDSP_vsmul(magSq.data(), 1, &scale, magSq.data(), 1, FFT_SIZE / 2);

    double binWidth = sampleRate / (double)FFT_SIZE;
    const double factor = std::pow(2.0, 1.0 / 6.0);

    for (int b = 0; b < 31; ++b) {
        double fc = RTA_CENTERS[b];
        double fLow = fc / factor;
        double fHigh = fc * factor;

        int kLow = (int)std::floor(fLow / binWidth);
        int kHigh = (int)std::ceil(fHigh / binWidth);
        if (kLow < 1) kLow = 1;
        if (kHigh >= FFT_SIZE / 2) kHigh = FFT_SIZE / 2 - 1;

        double sum = 0.0;
        for (int k = kLow; k <= kHigh; ++k) {
            sum += magSq[k];
        }

        double bandSPL = 10.0 * std::log10(std::max(sum, 1e-12)) + calibrationOffset;
        if (bandSPL < 20.0) bandSPL = 20.0;
        if (bandSPL > 140.0) bandSPL = 140.0;

        rtaBands[b] = (float)(0.65 * rtaBands[b] + 0.35 * bandSPL);
    }
}

void SPLEngine::calculateLeqs(double windowSec, double& outA, double& outC, double& outZ) {
    if (windowSec > 0.0) {
        int requiredSlices = (int)std::round(windowSec / 0.100);
        int slicesToSum = std::min(ringCount, requiredSlices);

        if (slicesToSum > 0) {
            double sumA = 0.0, sumC = 0.0, sumZ = 0.0;
            uint64_t totalCount = 0;

            for (int i = 0; i < slicesToSum; ++i) {
                int idx = (ringHead - 1 - i + RING_SIZE) % RING_SIZE;
                sumA += energyRing[idx].sumSqA;
                sumC += energyRing[idx].sumSqC;
                sumZ += energyRing[idx].sumSqZ;
                totalCount += energyRing[idx].count;
            }

            if (totalCount > 0) {
                outA = 10.0 * std::log10(std::max(sumA / (double)totalCount, 1e-14)) + calibrationOffset;
                outC = 10.0 * std::log10(std::max(sumC / (double)totalCount, 1e-14)) + calibrationOffset;
                outZ = 10.0 * std::log10(std::max(sumZ / (double)totalCount, 1e-14)) + calibrationOffset;
            } else {
                outA = 10.0 * std::log10(std::max(powerASlow, 1e-14)) + calibrationOffset;
                outC = 10.0 * std::log10(std::max(powerCSlow, 1e-14)) + calibrationOffset;
                outZ = 10.0 * std::log10(std::max(powerZSlow, 1e-14)) + calibrationOffset;
            }
        } else {
            outA = 10.0 * std::log10(std::max(powerASlow, 1e-14)) + calibrationOffset;
            outC = 10.0 * std::log10(std::max(powerCSlow, 1e-14)) + calibrationOffset;
            outZ = 10.0 * std::log10(std::max(powerZSlow, 1e-14)) + calibrationOffset;
        }
    } else {
        // Cumulative
        if (cumulativeCount > 0) {
            outA = 10.0 * std::log10(std::max(cumulativeSumSqA / (double)cumulativeCount, 1e-14)) + calibrationOffset;
            outC = 10.0 * std::log10(std::max(cumulativeSumSqC / (double)cumulativeCount, 1e-14)) + calibrationOffset;
            outZ = 10.0 * std::log10(std::max(cumulativeSumSqZ / (double)cumulativeCount, 1e-14)) + calibrationOffset;
        } else {
            outA = 10.0 * std::log10(std::max(powerASlow, 1e-14)) + calibrationOffset;
            outC = 10.0 * std::log10(std::max(powerCSlow, 1e-14)) + calibrationOffset;
            outZ = 10.0 * std::log10(std::max(powerZSlow, 1e-14)) + calibrationOffset;
        }
    }
}

SPLMetrics SPLEngine::getMetrics() {
    std::lock_guard<std::mutex> lock(dspMutex);
    SPLMetrics m;

    m.offset_dB = calibrationOffset;
    m.isCalFileLoaded = micCal.isLoaded;
    m.calFileName = micCal.filename;

    m.LAF = 10.0 * std::log10(std::max(powerAFast, 1e-14)) + calibrationOffset;
    m.LAS = 10.0 * std::log10(std::max(powerASlow, 1e-14)) + calibrationOffset;

    m.LCF = 10.0 * std::log10(std::max(powerCFast, 1e-14)) + calibrationOffset;
    m.LCS = 10.0 * std::log10(std::max(powerCSlow, 1e-14)) + calibrationOffset;

    m.LZF = 10.0 * std::log10(std::max(powerZFast, 1e-14)) + calibrationOffset;
    m.LZS = 10.0 * std::log10(std::max(powerZSlow, 1e-14)) + calibrationOffset;

    m.CminusA = m.LCS - m.LAS;
    m.CminusA_Fast = m.LCF - m.LAF;

    m.LCpeak = 20.0 * std::log10(std::max(peakC, 1e-7)) + calibrationOffset;
    m.LZpeak = 20.0 * std::log10(std::max(peakZ, 1e-7)) + calibrationOffset;

    if (m.LAS > maxLAS) maxLAS = m.LAS;
    if (m.LAS < minLAS && m.LAS > 10.0) minLAS = m.LAS;
    if (m.LCS > maxLCS) maxLCS = m.LCS;
    if (m.LZS > maxLZS) maxLZS = m.LZS;

    m.LAmax = maxLAS;
    m.LAmin = (minLAS > 140.0) ? 0.0 : minLAS;
    m.LCmax = maxLCS;
    m.LZmax = maxLZS;

    // Calculate Multi-Window Leqs for per-tile time ranges
    calculateLeqs(1.0, m.LAeq_1s, m.LCeq_1s, m.LZeq_1s);
    calculateLeqs(5.0, m.LAeq_5s, m.LCeq_5s, m.LZeq_5s);
    calculateLeqs(10.0, m.LAeq_10s, m.LCeq_10s, m.LZeq_10s);
    calculateLeqs(30.0, m.LAeq_30s, m.LCeq_30s, m.LZeq_30s);
    calculateLeqs(60.0, m.LAeq_1m, m.LCeq_1m, m.LZeq_1m);
    calculateLeqs(300.0, m.LAeq_5m, m.LCeq_5m, m.LZeq_5m);
    calculateLeqs(600.0, m.LAeq_10m, m.LCeq_10m, m.LZeq_10m);
    calculateLeqs(900.0, m.LAeq_15m, m.LCeq_15m, m.LZeq_15m);
    calculateLeqs(0.0, m.LAeq_total, m.LCeq_total, m.LZeq_total);

    m.CminusA_10s = m.LCeq_10s - m.LAeq_10s;
    m.CminusA_1m = m.LCeq_1m - m.LAeq_1m;
    m.CminusA_5m = m.LCeq_5m - m.LAeq_5m;
    m.CminusA_15m = m.LCeq_15m - m.LAeq_15m;

    m.leqElapsedSec = (cumulativeCount > 0) ? ((double)cumulativeCount / sampleRate) : 0.0;

    for (int i = 0; i < 31; ++i) {
        m.rta[i] = rtaBands[i];
    }

    return m;
}
